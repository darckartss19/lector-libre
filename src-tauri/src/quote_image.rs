use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(desktop)]
use std::borrow::Cow;
use std::sync::Mutex;
#[cfg(any(not(target_os = "android"), test))]
use std::{fs, io::Write, path::Path};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub struct QuoteIo(pub Mutex<()>);
impl Default for QuoteIo {
    fn default() -> Self {
        Self(Mutex::new(()))
    }
}

fn decode_card(png: &str) -> Result<(Vec<u8>, tauri::image::Image<'static>), String> {
    let encoded = png
        .strip_prefix("data:image/png;base64,")
        .ok_or("La tarjeta debe ser una imagen PNG.")?;
    // Card dimensions are fixed, so an oversized or unrelated payload is never decoded.
    if encoded.len() > 16_000_000 {
        return Err("La tarjeta es demasiado grande.".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "No se pudo leer la imagen de la tarjeta.")?;
    if bytes.len() < 33 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || &bytes[12..16] != b"IHDR" {
        return Err("La tarjeta no contiene una imagen PNG válida.".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width != 1080 || ![1080, 1920].contains(&height) {
        return Err("El tamaño de la tarjeta no es válido.".into());
    }
    let image = tauri::image::Image::from_bytes(&bytes)
        .map_err(|_| "No se pudo leer la imagen de la tarjeta.")?;
    if image.width() != width || image.height() != height {
        return Err("El tamaño de la tarjeta no es válido.".into());
    }
    Ok((bytes, image))
}
fn safe_filename(filename: &str) -> String {
    let cleaned: String = filename
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(90)
        .collect();
    let name = cleaned.trim().trim_end_matches([' ', '.']);
    if name.is_empty() {
        "Cita.png".into()
    } else if name.to_lowercase().ends_with(".png") {
        name.into()
    } else {
        format!("{name}.png")
    }
}
#[cfg(any(not(target_os = "android"), test))]
fn write_card(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    // A canceled/failed export cannot truncate an existing image.
    let parent = destination
        .parent()
        .ok_or("No se pudo elegir el destino de la tarjeta.")?;
    let temporary = parent.join(format!(".cita-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_| "No se pudo guardar la tarjeta. Comprueba la carpeta de destino.".into())
}
#[tauri::command]
pub async fn select_quote_background(app: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::cover::select_image(app, "Fondo de la tarjeta").await
}
#[tauri::command]
pub async fn save_quote_image(
    app: tauri::AppHandle,
    png: String,
    filename: String,
) -> Result<Option<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<QuoteIo>();
        let _lock = state
            .0
            .lock()
            .map_err(|_| "No se pudo preparar la tarjeta.")?;
        let (bytes, _image) = decode_card(&png)?;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Imagen PNG", &["png"])
            .set_file_name(safe_filename(&filename))
            .blocking_save_file()
        else {
            return Ok(None);
        };
        #[cfg(target_os = "android")]
        {
            crate::selected_document::write(&app, file, &bytes)?;
            return Ok(Some(true));
        }
        #[cfg(not(target_os = "android"))]
        let destination = file
            .into_path()
            .map_err(|_| "No se pudo elegir el destino de la tarjeta.")?;
        // Do not rewrite the chosen path and overwrite a different, unconfirmed file.
        #[cfg(not(target_os = "android"))]
        if destination
            .extension()
            .and_then(|s| s.to_str())
            .is_none_or(|s| !s.eq_ignore_ascii_case("png"))
        {
            return Err("Usa un nombre terminado en .png.".into());
        }
        #[cfg(not(target_os = "android"))]
        write_card(&destination, &bytes)?;
        #[cfg(not(target_os = "android"))]
        Ok(Some(true))
    })
    .await
    .map_err(|_| "No se pudo guardar la tarjeta.")?
}
#[tauri::command]
pub async fn copy_quote_image(app: tauri::AppHandle, png: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return mobile_card(app, png, true).await;
    #[cfg(all(mobile, not(target_os = "android")))]
    {
        let _ = (app, png);
        return Err("Guarda la tarjeta como PNG para compartirla desde tu teléfono.".into());
    }
    #[cfg(desktop)]
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let state = app.state::<QuoteIo>();
        let _lock = state
            .0
            .lock()
            .map_err(|_| "No se pudo preparar la tarjeta.")?;
        let (_bytes, image) = decode_card(&png)?;
        let mut clipboard =
            arboard::Clipboard::new().map_err(|_| "No se pudo abrir el portapapeles.")?;
        clipboard
            .set_image(arboard::ImageData {
                width: image.width() as usize,
                height: image.height() as usize,
                bytes: Cow::Owned(image.rgba().to_vec()),
            })
            .map_err(|_| "No se pudo copiar la imagen. Puedes guardarla como PNG.".to_string())
    })
    .await
    .map_err(|_| "No se pudo copiar la imagen.")?
}

#[cfg(target_os = "android")]
async fn mobile_card(app: tauri::AppHandle, png: String, copy: bool) -> Result<(), String> {
    let target = app.clone();
    let path = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let (bytes, _) = decode_card(&png)?;
        let folder = target
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("quote-share");
        std::fs::create_dir_all(&folder).map_err(|_| "No se pudo preparar la tarjeta.")?;
        let mut existing = std::fs::read_dir(&folder)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|e| {
                e.file_type().is_ok_and(|t| t.is_file())
                    && e.path().extension().is_some_and(|s| s == "png")
            })
            .collect::<Vec<_>>();
        existing.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        let remove = existing.len().saturating_sub(19);
        for old in existing.into_iter().take(remove) {
            let _ = std::fs::remove_file(old.path());
        }
        let file = folder.join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&file, bytes).map_err(|_| "No se pudo preparar la tarjeta.")?;
        Ok(file.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())??;
    tauri_plugin_reader_mobile::command(
        &app,
        "shareImage",
        serde_json::json!({"path":path,"copy":copy}),
    )
    .await
    .map(|_| ())
}

#[tauri::command]
pub async fn share_quote_image(app: tauri::AppHandle, png: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return mobile_card(app, png, false).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, png);
        Err("Guarda el PNG para compartirlo desde tu equipo.".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn card_payload_rejects_unrelated_data_before_decode() {
        assert!(decode_card("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(decode_card("data:image/png;base64,broken").is_err());
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&u32::MAX.to_be_bytes());
        bytes.extend_from_slice(&1920u32.to_be_bytes());
        bytes.resize(33, 0);
        assert!(
            decode_card(&format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
                .unwrap_err()
                .contains("tamaño")
        );
    }
    #[test]
    fn image_names_are_plain_names() {
        assert_eq!(safe_filename("../cita<>*.png"), "..cita.png");
        assert_eq!(safe_filename("..."), "Cita.png");
        assert_eq!(safe_filename("Lectura"), "Lectura.png");
    }
    #[test]
    fn export_replaces_only_the_confirmed_file_and_cleans_failed_writes() {
        let root = std::env::temp_dir().join(format!("quote-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let target = root.join("cita.png");
        fs::write(&target, b"previous").unwrap();
        write_card(&target, b"complete image").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"complete image");
        let directory = root.join("occupied.png");
        fs::create_dir(&directory).unwrap();
        assert!(write_card(&directory, b"new").is_err());
        assert!(directory.is_dir());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}

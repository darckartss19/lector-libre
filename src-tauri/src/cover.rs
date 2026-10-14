use base64::{engine::general_purpose::STANDARD, Engine};
use tauri_plugin_dialog::DialogExt;
fn mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
#[tauri::command]
pub async fn select_cover(app: tauri::AppHandle) -> Result<Option<String>, String> {
    select_image(app, "Portadas").await
}
pub async fn select_image(
    app: tauri::AppHandle,
    label: &'static str,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter(label, &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let bytes = crate::selected_document::read(&app, file)?;
        let kind = mime(&bytes).ok_or("Elige una imagen PNG, JPEG o WebP válida.")?;
        Ok(Some(format!(
            "data:{kind};base64,{}",
            STANDARD.encode(bytes)
        )))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_content_instead_of_extension() {
        assert_eq!(mime(b"\x89PNG\r\n\x1a\nxyz"), Some("image/png"));
        assert_eq!(mime(b"\xff\xd8\xff\xe0"), Some("image/jpeg"));
        assert_eq!(mime(b"RIFF1234WEBP"), Some("image/webp"));
        assert_eq!(mime(b"<svg></svg>"), None);
        assert_eq!(mime(b"PNG"), None);
    }
}

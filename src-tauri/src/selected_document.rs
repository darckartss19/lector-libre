#[cfg(target_os = "android")]
use std::io::Write;
use std::{fs::File, io::Read};
use tauri_plugin_dialog::FilePath;
use tauri_plugin_fs::{FsExt, OpenOptions};

// A selected Android document is a provider URI, not a filesystem path.
pub fn open(app: &tauri::AppHandle, file: FilePath) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    app.fs()
        .open(file, options)
        .map_err(|_| "No se pudo abrir el documento seleccionado.".into())
}

pub fn read(app: &tauri::AppHandle, file: FilePath) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    open(app, file)?
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[cfg(target_os = "android")]
pub fn write(app: &tauri::AppHandle, file: FilePath, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).truncate(true);
    let mut target = app.fs().open(file, options).map_err(|e| e.to_string())?;
    target.write_all(bytes).map_err(|e| e.to_string())?;
    target.flush().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
pub fn copy_out(
    app: &tauri::AppHandle,
    file: FilePath,
    source: &std::path::Path,
) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).truncate(true);
    let mut target = app.fs().open(file, options).map_err(|e| e.to_string())?;
    std::io::copy(
        &mut File::open(source).map_err(|e| e.to_string())?,
        &mut target,
    )
    .map_err(|e| e.to_string())?;
    target.flush().map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
pub fn staged<T>(
    app: &tauri::AppHandle,
    run: impl FnOnce(&std::path::Path) -> Result<T, String>,
) -> Result<T, String> {
    use tauri::Manager;
    struct Temporary(std::path::PathBuf);
    impl Drop for Temporary {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let temporary = Temporary(cache.join(format!("transfer-{}.zip", uuid::Uuid::new_v4())));
    run(&temporary.0)
}

#[cfg(target_os = "android")]
pub fn display_name(app: &tauri::AppHandle, file: &FilePath) -> Result<String, String> {
    match file {
        FilePath::Path(path) => Ok(path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()),
        FilePath::Url(uri) => {
            let info = tauri_plugin_reader_mobile::document_info(app, uri.as_str())?;
            info["name"]
                .as_str()
                .map(str::to_owned)
                .ok_or("El documento no tiene nombre.".into())
        }
    }
}

#[cfg(any(target_os = "android", test))]
pub fn book_name(name: &str) -> Option<(String, String)> {
    // Provider names are only metadata; never use them as local storage paths.
    let (_, extension) = name.rsplit_once('.')?;
    let format = extension.to_ascii_lowercase();
    crate::book_files::valid_format(&format)
        .then(|| (format, name[..name.len() - extension.len() - 1].to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_names_use_supported_extensions_and_preserve_unicode() {
        assert_eq!(
            book_name("El árbol.EPUB"),
            Some(("epub".into(), "El árbol".into()))
        );
        assert_eq!(
            book_name("manga.volumen.1.CBZ"),
            Some(("cbz".into(), "manga.volumen.1".into()))
        );
        assert_eq!(book_name("content://provider/document/123"), None);
        assert_eq!(book_name("archivo.exe"), None);
    }
}

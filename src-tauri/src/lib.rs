mod assets;
mod backup;
mod book_files;
mod cover;
mod diagnostics;
mod drive;
mod mobile;
mod neural;
mod quote_image;
mod release_policy;
mod selected_document;
mod speech;
mod state_store;
use serde_json::{json, Value};
use state_store::{load_state, save_state, Storage};
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("books")).map_err(|e| e.to_string())?;
    Ok(dir)
}
pub fn write_json(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    match fs::read(path) {
        Ok(previous) if serde_json::from_slice::<Value>(&previous).is_ok() => {
            replace_bytes(&path.with_extension("bak"), &previous)?;
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    replace_bytes(path, &bytes)
}
pub fn replace_json(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    replace_bytes(path, &bytes)
}
fn replace_bytes(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Destino de guardado no válido")?;
    let temporary = parent.join(format!(".lector-json-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        // Same-directory rename replaces the destination without deleting it first.
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temporary);
    result
}
#[tauri::command]
async fn import_files(app: tauri::AppHandle, deferred: Option<bool>) -> Result<Vec<Value>, String> {
    #[cfg(target_os = "android")]
    let _ = deferred;
    tauri::async_runtime::spawn_blocking(move || {
        let files=app.dialog().file().add_filter("Libros",&book_files::supported_extensions()).blocking_pick_files().unwrap_or_default();
        let files_were_empty = files.is_empty();
        let dir=directory(&app)?; let mut result=vec![];
        for file in files {
            #[cfg(target_os = "android")]
            {
                let name = selected_document::display_name(&app, &file)?;
                let Some((format, filename)) = selected_document::book_name(&name) else { continue; };
                let reader = selected_document::open(&app, file)?;
                let (id, size) = book_files::receive(&dir.join("books"), &format, reader, None, || false)?;
                result.push(json!({"id":id,"format":format,"filename":filename,"size":size}));
            }
            #[cfg(not(target_os = "android"))]
            {
                let path=file.into_path().map_err(|e|e.to_string())?;
                let format=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
                if !book_files::valid_format(&format) {continue;}
                if deferred.unwrap_or(false) {
                    result.push(json!({"source":path.to_string_lossy(),"format":format,"filename":path.file_stem().and_then(|s|s.to_str()).unwrap_or("Libro")}));
                    continue;
                }
                let (id,size)=book_files::receive(&dir.join("books"),&format,fs::File::open(&path).map_err(|e|e.to_string())?,None,||false)?;
                result.push(json!({"id":id,"format":format,"filename":path.file_stem().and_then(|s|s.to_str()).unwrap_or("Libro"),"size":size}));
            }
        }
        if result.is_empty() && !files_were_empty {return Err("No hay documentos compatibles en esta selección.".into());}
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn import_local_file(app: tauri::AppHandle, source: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(source);
        let format = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if !book_files::valid_format(&format) { return Err("Formato no compatible".into()); }
        let (id, size) = book_files::receive(&directory(&app)?.join("books"), &format,
            fs::File::open(&path).map_err(|e| e.to_string())?, None, || false)?;
        Ok(json!({"id":id,"size":size,"format":format,"filename":path.file_stem().and_then(|s|s.to_str()).unwrap_or("Libro")}))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_book(
    app: tauri::AppHandle,
    id: String,
    format: String,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(book_files::path(
            &directory(&app)?.join("books"),
            &id,
            &format,
        )?)
        .map_err(|e| e.to_string())?;
        diagnostics::record(&app, "book.read", Some(bytes.len() as u64));
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn book_availability(
    app: tauri::AppHandle,
    books: Vec<Value>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = directory(&app)?.join("books");
        Ok(books
            .iter()
            .filter_map(|book| {
                let id = book["id"].as_str()?;
                let format = book["format"].as_str()?;
                book_files::path(&root, id, format)
                    .ok()
                    .filter(|p| p.is_file())
                    .map(|_| id.to_owned())
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_reader_mobile::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Storage::default())
        .manage(quote_image::QuoteIo::default())
        .manage(speech::Speech::default())
        .manage(speech::SleepTimer::default())
        .manage(backup::BackupLock::default())
        .manage(drive::DriveLock::default())
        .manage(neural::VoiceDownload::default())
        .setup(|app| {
            diagnostics::initialize(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            mobile_chrome,
            mobile::mobile_speech,
            mobile::mobile_scan,
            mobile::mobile_import_scanned,
            mobile_background,
            load_state,
            save_state,
            assets::cover_asset,
            state_store::store_cover,
            assets::spine_asset,
            assets::import_queue,
            import_files,
            import_local_file,
            read_book,
            book_availability,
            diagnostics::diagnostic_event,
            speech::speech_command,
            speech::speech_timer,
            speech::speech_timer_status,
            backup::export_backup,
            backup::import_backup,
            cover::select_cover,
            quote_image::select_quote_background,
            quote_image::save_quote_image,
            quote_image::copy_quote_image,
            quote_image::share_quote_image,
            neural::neural_catalog,
            neural::neural_install,
            drive::drive_config,
            drive::drive_connect,
            drive::drive_sync,
            drive::drive_disconnect,
            drive::drive_books_sync,
            drive::drive_list_folder,
            drive::drive_import_file,
            drive::drive_use_folder,
            drive::drive_cancel
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                diagnostics::record(window.app_handle(), "window.destroyed", None);
                speech::stop(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("No se pudo abrir Lector libre");
}

#[tauri::command]
fn platform_info() -> Value {
    json!({"platform":std::env::consts::OS,"mobile":cfg!(mobile),
        "speech":cfg!(windows)||cfg!(target_os="android"),"drive":release_policy::drive_enabled(),"publicPreview":!cfg!(feature="drive-sync"),"imageClipboard":cfg!(desktop)||cfg!(target_os="android")})
}
#[tauri::command]
fn mobile_background(_app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_reader_mobile::background(&_app);
    #[cfg(not(target_os = "android"))]
    Ok(())
}

#[tauri::command]
async fn mobile_chrome(
    _app: tauri::AppHandle,
    background: String,
    dark_icons: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_reader_mobile::set_chrome(&_app, &background, dark_icons).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = (background, dark_icons);
        Ok(())
    }
}

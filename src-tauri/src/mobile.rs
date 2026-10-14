use serde_json::{json, Value};

#[tauri::command]
pub async fn mobile_speech(app: tauri::AppHandle, command: Value) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    return tauri_plugin_reader_mobile::command(&app, "speechAction", json!({"command":command}))
        .await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command);
        Err("Esta función requiere Android.".into())
    }
}

#[tauri::command]
pub async fn mobile_scan(app: tauri::AppHandle, mut command: Value) -> Result<Value, String> {
    if !["scan", "folder", "cancel", "sources"].contains(&command["action"].as_str().unwrap_or(""))
    {
        return Err("Orden de búsqueda no válida.".into());
    }
    command["extensions"] = json!(crate::book_files::supported_extensions());
    #[cfg(target_os = "android")]
    return tauri_plugin_reader_mobile::command(&app, "scanAction", command).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command);
        Err("Esta función requiere Android.".into())
    }
}

#[tauri::command]
pub async fn mobile_import_scanned(
    app: tauri::AppHandle,
    keys: Vec<String>,
) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let selected = tauri_plugin_reader_mobile::command(
            &app,
            "scanAction",
            json!({"action":"selected","keys":keys}),
        )
        .await?;
        return tauri::async_runtime::spawn_blocking(move || {
            let dir = crate::directory(&app)?;
            let mut files = Vec::new();
            let mut failures = Vec::new();
            for record in selected["files"]
                .as_array()
                .ok_or("Selección de documentos no válida.")?
            {
                let name = record["name"].as_str().unwrap_or("Documento");
                let copied = (|| -> Result<Value, String> {
                    let (format, filename) = crate::selected_document::book_name(name)
                        .ok_or("Formato no compatible.")?;
                    let uri =
                        url::Url::parse(record["uri"].as_str().ok_or("Documento no disponible.")?)
                            .map_err(|_| "Documento no válido.")?;
                    if uri.scheme() != "content" {
                        return Err("Documento no válido.".into());
                    }
                    let reader = crate::selected_document::open(
                        &app,
                        tauri_plugin_dialog::FilePath::Url(uri),
                    )?;
                    let (id, size) = crate::book_files::receive(
                        &dir.join("books"),
                        &format,
                        reader,
                        None,
                        || false,
                    )?;
                    Ok(json!({"id":id,"format":format,"filename":filename,"size":size}))
                })();
                match copied {
                    Ok(file) => files.push(file),
                    Err(message) => failures.push(json!({"name":name,"message":message})),
                }
            }
            Ok(json!({"files":files,"errors":failures}))
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, keys);
        Err("Esta función requiere Android.".into())
    }
}

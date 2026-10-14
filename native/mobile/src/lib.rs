#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
struct Mobile<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("reader-mobile")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Mobile(_api.register_android_plugin(
                "org.lectorlibre.mobile",
                "LibraryPlugin",
            )?));
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
pub fn document_info<R: Runtime>(
    app: &tauri::AppHandle<R>,
    uri: &str,
) -> Result<serde_json::Value, String> {
    app.state::<Mobile<R>>()
        .0
        .run_mobile_plugin("documentInfo", serde_json::json!({"uri": uri}))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
pub fn background<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    app.state::<Mobile<R>>()
        .0
        .run_mobile_plugin::<serde_json::Value>("background", serde_json::json!({}))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
pub async fn set_chrome<R: Runtime>(
    app: &tauri::AppHandle<R>,
    background: &str,
    dark_icons: bool,
) -> Result<(), String> {
    app.state::<Mobile<R>>()
        .0
        .run_mobile_plugin_async::<serde_json::Value>(
            "setChrome",
            serde_json::json!({"background":background,"darkIcons":dark_icons}),
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
pub async fn command<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    app.state::<Mobile<R>>()
        .0
        .run_mobile_plugin_async(method, payload)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
pub fn blocking_command<R: Runtime>(
    app: &tauri::AppHandle<R>,
    method: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    app.state::<Mobile<R>>()
        .0
        .run_mobile_plugin(method, payload)
        .map_err(|e| e.to_string())
}

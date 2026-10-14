use serde_json::json;
use std::{
    fs,
    io::Write,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

static LOG_LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn append(path: &Path, event: &str, number: Option<u64>, max: u64) -> std::io::Result<()> {
    fs::create_dir_all(path.parent().unwrap())?;
    if fs::metadata(path).map(|m| m.len() >= max).unwrap_or(false) {
        let previous = path.with_extension("previous.jsonl");
        if previous.exists() {
            fs::remove_file(&previous)?;
        }
        fs::rename(path, previous)?;
    }
    let line = json!({
        "timeUnixMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION"),
        "event": event, "number": number,
    });
    writeln!(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?,
        "{line}"
    )
}

pub fn record(app: &tauri::AppHandle, event: &str, number: Option<u64>) {
    let Ok(_lock) = LOG_LOCK.lock() else { return };
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = append(
            &dir.join("logs/lector-libre.jsonl"),
            event,
            number,
            MAX_BYTES,
        );
    }
}

#[tauri::command]
pub fn diagnostic_event(
    app: tauri::AppHandle,
    event: String,
    number: Option<u64>,
) -> Result<(), String> {
    // Never accept error text, book contents, paths, account details or tokens.
    if ![
        "frontend.ready",
        "performance.startup_ms",
        "performance.open_ms",
        "performance.chapter_ms",
        "performance.library_ms",
        "performance.long_task_ms",
        "performance.heap_bytes",
        "performance.cover_cache_bytes",
        "performance.import_ms",
        "frontend.error",
        "frontend.rejection",
        "sync.start",
        "sync.end",
        "sync.failed",
        "import.start",
        "import.end",
        "import.failed",
        "book.parse.start",
        "book.parse.end",
    ]
    .contains(&event.as_str())
    {
        return Err("Evento no válido.".into());
    }
    record(&app, &event, number);
    Ok(())
}

pub fn initialize(app: &tauri::AppHandle) {
    record(app, "session.start", None);
    let handle = app.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record(
            &handle,
            "native.panic",
            info.location().map(|p| p.line() as u64),
        );
        previous(info);
    }));
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window("main") {
        let handle = app.clone();
        let _ = window.with_webview(move |webview| unsafe {
            let attach = || -> Result<(), Box<dyn std::error::Error>> {
                let core = webview.controller().CoreWebView2()?;
                let log = handle.clone();
                let mut token = 0;
                core.add_ProcessFailed(
                    &webview2_com::ProcessFailedEventHandler::create(Box::new(move |_, args| {
                        let mut kind = Default::default();
                        let number = args
                            .and_then(|a| a.ProcessFailedKind(&mut kind).ok())
                            .map(|_| kind.0 as u64);
                        record(&log, "webview.process_failed", number);
                        Ok(())
                    })),
                    &mut token,
                )?;
                Ok(())
            };
            record(
                &handle,
                if attach().is_ok() {
                    "webview.monitor.ready"
                } else {
                    "webview.monitor.failed"
                },
                None,
            );
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotates_local_events_without_collecting_private_payloads() {
        let dir = std::env::temp_dir().join(format!("lector-log-{}", uuid::Uuid::new_v4()));
        let path = dir.join("events.jsonl");
        append(&path, "session.start", None, 1).unwrap();
        append(&path, "book.read", Some(104_000_000), 1).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["event"], "book.read");
        assert_eq!(value.as_object().unwrap().len(), 5);
        assert!(path.with_extension("previous.jsonl").is_file());
        fs::remove_dir_all(dir).unwrap();
    }
}

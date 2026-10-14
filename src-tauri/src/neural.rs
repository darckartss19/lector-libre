use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct VoiceDownload(pub Mutex<()>);
pub fn catalog() -> Value {
    serde_json::from_str(include_str!("../../native/windows/voice-catalog.json"))
        .expect("Bundled voice catalog")
}
fn runtime_ready(root: &Path) -> bool {
    let folder = root.join("runtime/piper");
    [
        "piper.exe",
        "onnxruntime.dll",
        "piper_phonemize.dll",
        "espeak-ng.dll",
    ]
    .iter()
    .all(|file| folder.join(file).is_file())
        && folder.join("espeak-ng-data").is_dir()
}
fn ready(root: &Path, voice: &Value) -> bool {
    let key = voice["key"].as_str().unwrap();
    let folder = root.join(key);
    fs::read_to_string(folder.join("installed.sha256"))
        .ok()
        .as_deref()
        == voice["modelSha256"].as_str()
        && folder.join(format!("{key}.onnx")).is_file()
        && folder.join(format!("{key}.onnx.json")).is_file()
        && fs::metadata(folder.join(format!("{key}.onnx")))
            .ok()
            .is_some_and(|file| Some(file.len()) == voice["size"].as_u64())
        && runtime_ready(root)
}
#[tauri::command]
pub fn neural_catalog(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return Ok(Vec::new());
    }
    #[cfg(not(target_os = "android"))]
    {
        let root = crate::directory(&app)?.join("voices");
        Ok(catalog()["voices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                let mut item = v.clone();
                item["installed"] = json!(ready(&root, v));
                item
            })
            .collect())
    }
}
fn download(
    client: &reqwest::blocking::Client,
    url: &str,
    path: &Path,
    expected: &str,
    size: Option<u64>,
    progress: impl FnMut(u64),
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .map_err(|_| "No se pudo descargar la voz. Comprueba la conexión.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "La descarga de voz devolvió {}.",
            response.status().as_u16()
        ));
    }
    copy_verified(&mut response, path, expected, size, progress)
}
fn copy_verified(
    reader: &mut impl Read,
    path: &Path,
    expected: &str,
    size: Option<u64>,
    mut progress: impl FnMut(u64),
) -> Result<(), String> {
    let mut output =
        fs::File::create(path).map_err(|_| "No se pudo guardar la descarga de voz.".to_owned())?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    let mut total = 0u64;
    let mut last_progress = Instant::now();
    let work = (|| {
        progress(0);
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|_| "Se interrumpió la descarga de voz. Puedes reintentar.".to_owned())?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if size.is_some_and(|max| total > max) {
                return Err("El tamaño de la voz no coincide con el catálogo.".into());
            }
            digest.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|_| "No hay espacio para guardar la voz.".to_owned())?;
            if last_progress.elapsed() >= Duration::from_millis(250) {
                progress(total);
                last_progress = Instant::now();
            }
        }
        output.sync_all().map_err(|e| e.to_string())?;
        if size.is_some_and(|expected| total != expected)
            || format!("{:x}", digest.finalize()) != expected
        {
            return Err(
                "La descarga de voz no pasó la comprobación de integridad. Puedes reintentar."
                    .into(),
            );
        }
        progress(total);
        Ok(())
    })();
    drop(output);
    if work.is_err() {
        let _ = fs::remove_file(path);
    }
    work
}
// All destinations are immediate children of the app-owned voice directory.
// Preserve and restore an incomplete old cache if the atomic promotion fails.
fn promote(prepared: &Path, destination: &Path, root: &Path) -> Result<(), String> {
    let resolved_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if destination
        .parent()
        .and_then(|parent| fs::canonicalize(parent).ok())
        .as_ref()
        != Some(&resolved_root)
    {
        return Err("Ruta de instalación de voz no válida.".into());
    }
    let previous = if destination.exists() {
        if fs::symlink_metadata(destination)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("La carpeta de voz debe estar en este dispositivo.".into());
        }
        let backup = root.join(format!("replaced-{}", uuid::Uuid::new_v4().simple()));
        fs::rename(destination, &backup).map_err(|e| e.to_string())?;
        Some(backup)
    } else {
        None
    };
    if let Err(error) = fs::rename(prepared, destination) {
        if let Some(backup) = &previous {
            let _ = fs::rename(backup, destination);
        }
        return Err(error.to_string());
    }
    if let Some(backup) = previous {
        // Check the resolved target before removing this app-created backup.
        if fs::canonicalize(&backup)
            .ok()
            .is_some_and(|path| path.starts_with(&resolved_root))
        {
            let _ = fs::remove_dir_all(backup);
        }
    }
    Ok(())
}
fn unpack(archive: &Path, target: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = file
            .enclosed_name()
            .ok_or("Ruta de motor de voz no válida.")?;
        if !name.starts_with("piper") {
            return Err("Estructura de motor de voz no válida.".into());
        }
        let destination = target.join(name);
        if file.is_dir() {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
            std::io::copy(
                &mut file,
                &mut fs::File::create(destination).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn neural_install(app: tauri::AppHandle, voice_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<VoiceDownload>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Ya se está descargando una voz.".to_owned())?;
        let catalog = catalog();
        let voice = catalog["voices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == voice_id)
            .ok_or("Voz fuera del catálogo.")?;
        let root = crate::directory(&app)?.join("voices");
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        if ready(&root, voice) {
            return Ok(voice.clone());
        }
        let stage = root.join(format!("download-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let work = (|| {
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(30))
                .timeout(None)
                .build()
                .map_err(|e| e.to_string())?;
            if !runtime_ready(&root) {
                let runtime = &catalog["runtime"];
                let zip = stage.join("runtime.zip");
                download(
                    &client,
                    runtime["url"].as_str().unwrap(),
                    &zip,
                    runtime["sha256"].as_str().unwrap(),
                    runtime["size"].as_u64(),
                    |bytes| {
                        let _ = app.emit(
                            "voice-download",
                            json!({"phase":"engine","bytes":bytes,"total":runtime["size"]}),
                        );
                    },
                )?;
                let extracted = stage.join("runtime");
                unpack(&zip, &extracted)?;
                if ![
                    "piper.exe",
                    "onnxruntime.dll",
                    "piper_phonemize.dll",
                    "espeak-ng.dll",
                ]
                .iter()
                .all(|file| extracted.join("piper").join(file).is_file())
                    || !extracted.join("piper/espeak-ng-data").is_dir()
                {
                    return Err("El motor descargado está incompleto.".into());
                }
                promote(&extracted, &root.join("runtime"), &root)?;
            }
            let key = voice["key"].as_str().unwrap();
            let folder = stage.join(key);
            fs::create_dir(&folder).map_err(|e| e.to_string())?;
            download(
                &client,
                voice["modelUrl"].as_str().unwrap(),
                &folder.join(format!("{key}.onnx")),
                voice["modelSha256"].as_str().unwrap(),
                voice["size"].as_u64(),
                |bytes| {
                    let _ = app.emit(
                        "voice-download",
                        json!({"phase":"voice","bytes":bytes,"total":voice["size"]}),
                    );
                },
            )?;
            download(
                &client,
                voice["configUrl"].as_str().unwrap(),
                &folder.join(format!("{key}.onnx.json")),
                voice["configSha256"].as_str().unwrap(),
                None,
                |_| {},
            )?;
            fs::write(
                folder.join("MODEL_CARD.txt"),
                voice["license"].as_str().unwrap_or(""),
            )
            .map_err(|e| e.to_string())?;
            fs::write(
                folder.join("installed.sha256"),
                voice["modelSha256"].as_str().unwrap(),
            )
            .map_err(|e| e.to_string())?;
            promote(&folder, &root.join(key), &root)?;
            fs::write(
                root.join("RUNTIME_LICENSES.txt"),
                include_str!("../../native/windows/PIPER_NOTICES.txt"),
            )
            .map_err(|e| e.to_string())?;
            Ok(voice.clone())
        })();
        // Only the UUID staging directory created by this invocation is removed.
        let _ = fs::remove_dir_all(stage);
        work
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Error, ErrorKind};
    struct Workspace(std::path::PathBuf);
    impl Workspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("lector-voices-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for Workspace {
        fn drop(&mut self) {
            if fs::canonicalize(&self.0).ok().as_ref() == Some(&self.0) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }
    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    #[test]
    fn unknown_voice_ids_are_not_paths() {
        let data = catalog();
        let voices = data["voices"].as_array().unwrap();
        for v in voices {
            assert!(v["key"]
                .as_str()
                .unwrap()
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'));
            assert!(v["modelUrl"]
                .as_str()
                .unwrap()
                .starts_with("https://huggingface.co/rhasspy/piper-voices/resolve/"));
            assert_eq!(v["modelSha256"].as_str().unwrap().len(), 64);
        }
        assert!(!voices.iter().any(|v| v["id"] == "../../bad"));
    }
    #[test]
    fn corrupt_or_missing_downloads_are_not_installed() {
        let workspace = Workspace::new();
        let root = &workspace.0;
        let mut voice = catalog()["voices"][0].clone();
        voice["size"] = json!(3);
        assert!(!ready(root, &voice));
        let runtime = root.join("runtime/piper");
        fs::create_dir_all(runtime.join("espeak-ng-data")).unwrap();
        for file in [
            "piper.exe",
            "onnxruntime.dll",
            "piper_phonemize.dll",
            "espeak-ng.dll",
        ] {
            fs::write(runtime.join(file), b"test").unwrap();
        }
        let key = voice["key"].as_str().unwrap();
        let folder = root.join(key);
        fs::create_dir(&folder).unwrap();
        fs::write(
            folder.join("installed.sha256"),
            voice["modelSha256"].as_str().unwrap(),
        )
        .unwrap();
        fs::write(folder.join(format!("{key}.onnx.json")), b"{}").unwrap();
        fs::write(folder.join(format!("{key}.onnx")), b"abc").unwrap();
        assert!(ready(root, &voice));
        fs::write(folder.join(format!("{key}.onnx")), b"ab").unwrap();
        assert!(
            !ready(root, &voice),
            "A truncated model must not be offered as installed"
        );
    }
    #[test]
    fn download_verifies_hash_length_and_throttles_progress() {
        let workspace = Workspace::new();
        let file = workspace.0.join("voice.onnx");
        let bytes = vec![17; 4 * 1024 * 1024];
        let mut events = Vec::new();
        copy_verified(
            &mut Cursor::new(&bytes),
            &file,
            &digest(&bytes),
            Some(bytes.len() as u64),
            |total| events.push(total),
        )
        .unwrap();
        assert_eq!(fs::read(&file).unwrap(), bytes);
        assert_eq!(events.first(), Some(&0));
        assert_eq!(events.last(), Some(&(bytes.len() as u64)));
        assert!(events.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(
            events.len() < 8,
            "Fast downloads should not emit one UI event per 64 KiB"
        );
        for (expected, size) in [
            (digest(b"wrong bytes"), Some(bytes.len() as u64)),
            (digest(&bytes), Some(bytes.len() as u64 + 1)),
            (digest(&bytes), Some(5)),
        ] {
            assert!(
                copy_verified(&mut Cursor::new(&bytes), &file, &expected, size, |_| {}).is_err()
            );
            assert!(
                !file.exists(),
                "An invalid download must not leave a model file"
            );
        }
    }
    #[test]
    fn interrupted_download_removes_partial_model() {
        struct Interrupted(bool);
        impl Read for Interrupted {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                if self.0 {
                    return Err(Error::new(
                        ErrorKind::ConnectionReset,
                        "fixture interruption",
                    ));
                }
                self.0 = true;
                buffer[..3].copy_from_slice(b"abc");
                Ok(3)
            }
        }
        let workspace = Workspace::new();
        let file = workspace.0.join("interrupted.onnx");
        let error = copy_verified(
            &mut Interrupted(false),
            &file,
            &digest(b"abcdef"),
            Some(6),
            |_| {},
        )
        .unwrap_err();
        assert!(error.contains("interrumpió"));
        assert!(!file.exists());
    }
    fn archive(path: &Path, entries: &[(&str, &[u8])]) {
        let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }
    #[test]
    fn runtime_archive_stays_inside_piper_directory() {
        let workspace = Workspace::new();
        let zip = workspace.0.join("runtime.zip");
        let extracted = workspace.0.join("extracted");
        archive(
            &zip,
            &[
                ("piper/piper.exe", b"fixture"),
                ("piper/espeak-ng-data/phondata", b"phonemes"),
            ],
        );
        unpack(&zip, &extracted).unwrap();
        assert_eq!(
            fs::read(extracted.join("piper/piper.exe")).unwrap(),
            b"fixture"
        );
        archive(&zip, &[("../escape", b"forbidden")]);
        assert!(unpack(&zip, &extracted).is_err());
        assert!(!workspace.0.join("escape").exists());
        archive(&zip, &[("other/executable.exe", b"forbidden")]);
        assert!(unpack(&zip, &extracted).is_err());
        assert!(!extracted.join("other").exists());
    }
    #[test]
    fn incomplete_install_can_be_replaced_and_failed_promotion_restores_it() {
        let workspace = Workspace::new();
        let root = &workspace.0;
        let destination = root.join("voice");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("old"), b"keep until promotion succeeds").unwrap();
        assert!(promote(&root.join("missing-stage"), &destination, root).is_err());
        assert!(destination.join("old").is_file());
        let prepared = root.join("stage");
        fs::create_dir(&prepared).unwrap();
        fs::write(prepared.join("new"), b"verified voice").unwrap();
        promote(&prepared, &destination, root).unwrap();
        assert_eq!(
            fs::read(destination.join("new")).unwrap(),
            b"verified voice"
        );
        assert!(!destination.join("old").exists());
        assert_eq!(fs::read_dir(root).unwrap().count(), 1);
        assert!(promote(
            &root.join("missing-stage"),
            &root.join("child/outside"),
            root
        )
        .is_err());
    }
}

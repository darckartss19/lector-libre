use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub fn checked_hash(hash: &str) -> Result<(), String> {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Referencia local no válida".into());
    }
    Ok(())
}
pub fn read_cover(root: &Path, hash: &str) -> Result<String, String> {
    checked_hash(hash)?;
    let bytes = fs::read(root.join("covers").join(format!("{hash}.cover")))
        .map_err(|_| "No se pudo recuperar una portada local")?;
    if format!("{:x}", Sha256::digest(&bytes)) != hash {
        return Err("La portada local está dañada".into());
    }
    String::from_utf8(bytes).map_err(|_| "Portada local no válida".into())
}
#[tauri::command]
pub async fn cover_asset(app: tauri::AppHandle, hash: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_cover(&crate::directory(&app)?, &hash))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn spine_asset(
    app: tauri::AppHandle,
    hash: String,
    design: Option<Value>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        checked_hash(&hash)?;
        let root = crate::directory(&app)?.join("spines-v1");
        let path = root.join(format!("{hash}.json"));
        if let Some(design) = design {
            if serde_json::to_vec(&design)
                .map_err(|e| e.to_string())?
                .len()
                > 24_000
            {
                return Err("Diseño de lomo no válido".into());
            }
            fs::create_dir_all(root).map_err(|e| e.to_string())?;
            crate::write_json(&path, &design)?;
            Ok(Some(design))
        } else {
            Ok(fs::read(path)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn import_queue(
    app: tauri::AppHandle,
    value: Option<Value>,
    clear: Option<bool>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::directory(&app)?.join("pending-import.json");
        if clear.unwrap_or(false) {
            crate::write_json(&path, &Value::Null)?;
            return Ok(None);
        }
        if let Some(value) = value {
            if !value.is_null()
                && (!value["files"].is_array()
                    || !["local", "drive"].contains(&value["kind"].as_str().unwrap_or("")))
            {
                return Err("Importación pendiente no válida".into());
            }
            crate::write_json(&path, &value)?;
            Ok(if value.is_null() { None } else { Some(value) })
        } else {
            match fs::read(path) {
                Ok(bytes) => Ok(serde_json::from_slice::<Option<Value>>(&bytes)
                    .map_err(|_| "No se pudo recuperar la importación pendiente")?),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_verifies_original_cover() {
        assert!(checked_hash("../../private").is_err());
        let root = std::env::temp_dir().join(format!("assets-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("covers")).unwrap();
        let original = "data:image/png;base64,example";
        let hash = format!("{:x}", Sha256::digest(original.as_bytes()));
        let path = root.join("covers").join(format!("{hash}.cover"));
        fs::write(&path, original).unwrap();
        assert_eq!(read_cover(&root, &hash).unwrap(), original);
        fs::write(path, "damaged").unwrap();
        assert!(read_cover(&root, &hash).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path, sync::Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct Storage(pub Mutex<Option<Value>>);
const PREFIX: &str = "@lector-cover:";
fn validate(value: &Value) -> Result<(), String> {
    if value["version"] != 1 || !value["books"].is_array() {
        return Err("Biblioteca no válida".into());
    }
    Ok(())
}
fn cover_fields(
    value: &mut Value,
    mut change: impl FnMut(&mut Value) -> Result<(), String>,
) -> Result<(), String> {
    if let Some(books) = value["books"].as_array_mut() {
        for book in books {
            if let Some(cover) = book.get_mut("cover") {
                change(cover)?;
            }
        }
    }
    if let Some(records) = value["registers"].as_object_mut() {
        for (key, record) in records {
            let parts: Vec<String> =
                serde_json::from_str(key).map_err(|_| "Registro local no válido")?;
            if parts.get(1).map(String::as_str) == Some("cover") {
                if let Some(cover) = record.get_mut("value") {
                    change(cover)?;
                }
            }
        }
    }
    Ok(())
}
// Exact original data URLs live once on disk, independently of small progress writes.
fn externalize(root: &Path, value: &mut Value) -> Result<(), String> {
    fs::create_dir_all(root.join("covers")).map_err(|e| e.to_string())?;
    let mut known: HashMap<String, String> = HashMap::new();
    cover_fields(value, |cover| {
        let Some(text) = cover.as_str() else {
            return Ok(());
        };
        if text.starts_with(PREFIX) {
            return Ok(());
        }
        if !text.starts_with("data:image/") {
            return Ok(());
        }
        let reference = if let Some(reference) = known.get(text) {
            reference.clone()
        } else {
            let hash = format!("{:x}", Sha256::digest(text.as_bytes()));
            let path = root.join("covers").join(format!("{hash}.cover"));
            if fs::read(&path)
                .map(|bytes| format!("{:x}", Sha256::digest(&bytes)) != hash)
                .unwrap_or(true)
            {
                use std::io::Write;
                let temporary = path.with_extension("tmp");
                let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
                file.write_all(text.as_bytes())
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
                drop(file);
                if path.exists() {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
                fs::rename(temporary, path).map_err(|e| e.to_string())?;
            }
            let reference = format!("{PREFIX}{hash}");
            known.insert(text.to_owned(), reference.clone());
            reference
        };
        *cover = Value::String(reference);
        Ok(())
    })
}
fn wire_state(root: &Path, value: &Value) -> Result<Value, String> {
    let mut wire = value.clone();
    let mut assets = Map::new();
    cover_fields(&mut wire, |cover| {
        let Some(hash) = cover.as_str().and_then(|s| s.strip_prefix(PREFIX)) else {
            return Ok(());
        };
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Referencia de portada local no válida".into());
        }
        if !assets.contains_key(hash) {
            let text = fs::read_to_string(root.join("covers").join(format!("{hash}.cover")))
                .map_err(|_| "No se pudo recuperar una portada local".to_string())?;
            if format!("{:x}", Sha256::digest(text.as_bytes())) != hash {
                return Err("La portada local está dañada".into());
            }
            assets.insert(hash.to_owned(), Value::String(text));
        }
        Ok(())
    })?;
    wire["localCoverAssets"] = Value::Object(assets);
    Ok(wire)
}
fn load_mode(root: &Path, lazy: bool) -> Result<(Value, Value), String> {
    let mut found = false;
    for file in ["state.json", "state.bak"] {
        let path = root.join(file);
        if !path.exists() {
            continue;
        }
        found = true;
        let attempt = (|| {
            let mut value: Value =
                serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            validate(&value)?;
            let mut legacy_covers = false;
            cover_fields(&mut value, |cover| {
                legacy_covers |= cover
                    .as_str()
                    .is_some_and(|text| text.starts_with("data:image/"));
                Ok(())
            })?;
            externalize(root, &mut value)?;
            let wire = if lazy {
                cover_fields(&mut value, |cover| {
                    if let Some(hash) = cover.as_str().and_then(|c| c.strip_prefix(PREFIX)) {
                        crate::assets::checked_hash(hash)?;
                        if !root.join("covers").join(format!("{hash}.cover")).is_file() {
                            return Err("No se pudo recuperar una portada local".into());
                        }
                    }
                    Ok(())
                })?;
                value.clone()
            } else {
                wire_state(root, &value)?
            };
            if file == "state.json" && legacy_covers {
                crate::write_json(&root.join("state.json"), &value)?;
            }
            Ok::<_, String>((value, wire))
        })();
        if let Ok(result) = attempt {
            return Ok(result);
        }
    }
    if found {
        return Err("No se pudo recuperar la biblioteca local. Se conservan sus archivos y la copia de seguridad.".into());
    }
    let value = json!({"version":1,"preferences":{"view":"covers"},"books":[],"deviceId":uuid::Uuid::new_v4().to_string(),"registers":{}});
    Ok((value.clone(), value))
}
#[cfg(test)]
fn load(root: &Path) -> Result<(Value, Value), String> {
    load_mode(root, false)
}

pub fn portable_covers(root: &Path, mut value: Value) -> Result<Value, String> {
    let mut assets: HashMap<String, String> = HashMap::new();
    cover_fields(&mut value, |cover| {
        if let Some(hash) = cover.as_str().and_then(|s| s.strip_prefix(PREFIX)) {
            let text = if let Some(text) = assets.get(hash) {
                text.clone()
            } else {
                let text = crate::assets::read_cover(root, hash)?;
                assets.insert(hash.to_owned(), text.clone());
                text
            };
            *cover = Value::String(text);
        }
        Ok(())
    })?;
    Ok(value)
}
fn apply_change(target: &mut Value, change: &Value) -> Result<(), String> {
    if target.is_null() {
        *target = json!({});
    }
    let object = target.as_object_mut().ok_or("Cambio local no válido")?;
    let set = change["set"].as_object().ok_or("Cambio local no válido")?;
    let remove = change["remove"]
        .as_array()
        .ok_or("Cambio local no válido")?;
    for key in remove {
        object.remove(key.as_str().ok_or("Campo local no válido")?);
    }
    for (key, value) in set {
        object.insert(key.clone(), value.clone());
    }
    Ok(())
}
fn patch_state(value: &Value, patch: &Value) -> Result<Value, String> {
    let mut next = value.clone();
    // Reserved fields are handled separately; a malformed patch cannot bypass them.
    for key in ["books", "registers", "localCoverAssets"] {
        if patch["top"]["set"].get(key).is_some()
            || patch["top"]["remove"]
                .as_array()
                .is_some_and(|keys| keys.iter().any(|k| k == key))
        {
            return Err("Cambio local no válido".into());
        }
    }
    apply_change(&mut next, &patch["top"])?;
    apply_change(&mut next["registers"], &patch["registers"])?;
    let books = next["books"].as_array_mut().ok_or("Biblioteca no válida")?;
    for change in patch["books"]
        .as_array()
        .ok_or("Cambios de libros no válidos")?
    {
        let id = change["id"].as_str().ok_or("Libro no válido")?;
        if let Some(book) = books.iter_mut().find(|b| b["id"] == id) {
            apply_change(book, change)?;
        } else {
            let mut book = json!({});
            apply_change(&mut book, change)?;
            books.push(book);
        }
        if books.iter().find(|b| b["id"] == id).is_none() {
            return Err("Identificador de libro no válido".into());
        }
    }
    if !patch["order"].is_null() {
        let mut by_id: HashMap<String, Value> = books
            .drain(..)
            .map(|b| (b["id"].as_str().unwrap_or("").to_owned(), b))
            .collect();
        for id in patch["order"].as_array().ok_or("Orden local no válido")? {
            books.push(
                by_id
                    .remove(id.as_str().ok_or("Libro no válido")?)
                    .ok_or("Orden local no válido")?,
            );
        }
    }
    validate(&next)?;
    Ok(next)
}
fn persist_value(root: &Path, cache: &mut Option<Value>, mut value: Value) -> Result<(), String> {
    validate(&value)?;
    externalize(root, &mut value)?;
    crate::write_json(&root.join("state.json"), &value)?;
    *cache = Some(value);
    Ok(())
}
#[tauri::command]
pub async fn load_state(app: tauri::AppHandle, lazy_covers: Option<bool>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Storage>();
        let mut cache = store.0.lock().map_err(|e| e.to_string())?;
        let (thin, wire) = load_mode(&crate::directory(&app)?, lazy_covers.unwrap_or(false))?;
        *cache = Some(thin);
        Ok(wire)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn store_cover(app: tauri::AppHandle, cover: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !cover.starts_with("data:image/") {
            return Err("Portada no válida".into());
        }
        let mut value = json!({"books":[{"cover":cover}]});
        externalize(&crate::directory(&app)?, &mut value)?;
        Ok(value["books"][0]["cover"].as_str().unwrap().to_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_state(
    app: tauri::AppHandle,
    value: Option<Value>,
    patch: Option<Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Storage>();
        let mut cache = store.0.lock().map_err(|e| e.to_string())?;
        let root = crate::directory(&app)?;
        let next = if let Some(patch) = patch {
            patch_state(
                cache.as_ref().ok_or("Primero abre la biblioteca local")?,
                &patch,
            )?
        } else {
            value.ok_or("Falta la biblioteca")?
        };
        persist_value(&root, &mut cache, next)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lector-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn fixture() -> Value {
        json!({"version":1,"books":[{"id":"a","title":"Original","cover":"data:image/png;base64,example","progress":0}],"preferences":{"theme":"night"},"registers":{"[\"a\",\"cover\"]":{"value":"data:image/png;base64,example"}}})
    }
    #[test]
    fn migration_preserves_covers_once_and_backup_remains_readable() {
        let root = root();
        let original = fixture();
        crate::write_json(&root.join("state.json"), &original).unwrap();
        let (thin, wire) = load(&root).unwrap();
        assert!(thin["books"][0]["cover"]
            .as_str()
            .unwrap()
            .starts_with(PREFIX));
        assert_eq!(wire["localCoverAssets"].as_object().unwrap().len(), 1);
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(root.join("state.bak")).unwrap()).unwrap(),
            original
        );
        assert_eq!(load(&root).unwrap().1, wire);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn patch_does_not_need_or_change_original_cover() {
        let root = root();
        let mut thin = fixture();
        externalize(&root, &mut thin).unwrap();
        let next = patch_state(&thin, &json!({"top":{"set":{},"remove":[]},"registers":{"set":{},"remove":[]},"books":[{"id":"a","set":{"progress":0.5},"remove":[]}],"order":null})).unwrap();
        assert_eq!(next["books"][0]["progress"], 0.5);
        assert_eq!(next["books"][0]["cover"], thin["books"][0]["cover"]);
        assert_eq!(next["preferences"], thin["preferences"]);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn lazy_startup_keeps_references_and_portable_exports_recover_exact_originals() {
        let root = root();
        let original = fixture();
        crate::write_json(&root.join("state.json"), &original).unwrap();
        let (thin, wire) = load_mode(&root, true).unwrap();
        assert_eq!(thin, wire);
        assert!(wire.get("localCoverAssets").is_none());
        assert_eq!(portable_covers(&root, wire).unwrap(), original);
        let mut portable = original.clone();
        portable["books"][0]["cover"] = Value::String("@lector-cover:../../private".into());
        assert!(portable_covers(&root, portable).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_cover_recovers_backup_and_never_returns_empty_library() {
        let root = root();
        let mut thin = fixture();
        externalize(&root, &mut thin).unwrap();
        crate::write_json(&root.join("state.json"), &thin).unwrap();
        fs::remove_dir_all(root.join("covers")).unwrap();
        assert!(load(&root).is_err());
        crate::write_json(&root.join("state.bak"), &fixture()).unwrap();
        assert_eq!(load(&root).unwrap().0["books"].as_array().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_write_keeps_the_previous_file_and_memory_checkpoint() {
        let root = root();
        let mut cache = None;
        persist_value(&root, &mut cache, fixture()).unwrap();
        let old_bytes = fs::read(root.join("state.json")).unwrap();
        let old_cache = cache.clone();
        fs::create_dir(root.join("state.tmp")).unwrap();
        let mut next = cache.clone().unwrap();
        next["books"][0]["progress"] = json!(0.75);
        assert!(persist_value(&root, &mut cache, next).is_err());
        assert_eq!(cache, old_cache);
        assert_eq!(fs::read(root.join("state.json")).unwrap(), old_bytes);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_cover_can_be_recovered_from_the_original_backup() {
        let root = root();
        crate::write_json(&root.join("state.json"), &fixture()).unwrap();
        let (thin, _) = load(&root).unwrap();
        let hash = thin["books"][0]["cover"]
            .as_str()
            .unwrap()
            .strip_prefix(PREFIX)
            .unwrap();
        fs::write(root.join("covers").join(format!("{hash}.cover")), "damaged").unwrap();
        let (_, wire) = load(&root).unwrap();
        assert_eq!(
            wire["localCoverAssets"][hash],
            "data:image/png;base64,example"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

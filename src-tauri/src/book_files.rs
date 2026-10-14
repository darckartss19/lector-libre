// Native book storage. Remote names never become local paths.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::OnceLock,
};

#[derive(Deserialize)]
struct DocumentFormat {
    id: String,
    mime: String,
    readable: bool,
}

fn definitions() -> &'static [DocumentFormat] {
    static FORMATS: OnceLock<Vec<DocumentFormat>> = OnceLock::new();
    FORMATS.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/core/document-formats.json"))
            .expect("Bundled document format definitions must be valid")
    })
}

pub fn supported_extensions() -> Vec<&'static str> {
    definitions()
        .iter()
        .filter(|entry| entry.readable)
        .map(|entry| entry.id.as_str())
        .collect()
}

pub fn catalog_extensions() -> Vec<&'static str> {
    definitions()
        .iter()
        .map(|entry| entry.id.as_str())
        .collect()
}

pub fn mime_type(format: &str) -> &'static str {
    definitions()
        .iter()
        .find(|entry| entry.id == format)
        .map(|entry| entry.mime.as_str())
        .unwrap_or("application/octet-stream")
}

pub fn already_compressed(format: &str) -> bool {
    matches!(format, "epub" | "pdf" | "docx" | "odt" | "cbz")
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub fn valid_format(format: &str) -> bool {
    definitions()
        .iter()
        .any(|entry| entry.id == format && entry.readable)
}
pub fn path(root: &Path, id: &str, format: &str) -> Result<PathBuf, String> {
    if !valid_id(id) || !valid_format(format) {
        return Err("Libro no válido.".into());
    }
    Ok(root.join(format!("{id}.{format}")))
}
pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop {
        let n = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&chunk[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
// Write to a unique temporary file; interrupted or corrupt transfers leave existing books intact.
pub fn receive<R: Read>(
    root: &Path,
    format: &str,
    mut reader: R,
    expected: Option<&str>,
    mut cancelled: impl FnMut() -> bool,
) -> Result<(String, u64), String> {
    if !valid_format(format) || expected.is_some_and(|id| !valid_id(id)) {
        return Err("Libro remoto no válido.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = root.join(format!("{}.part", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut chunk = [0u8; 65536];
        loop {
            if cancelled() {
                return Err("Transferencia detenida. Los libros ya guardados se conservan.".into());
            }
            let n = reader
                .read(&mut chunk)
                .map_err(|_| "Se interrumpió la descarga; puedes reintentarlo.".to_string())?;
            if n == 0 {
                break;
            }
            size += n as u64;
            hash.update(&chunk[..n]);
            output.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        let id = format!("{:x}", hash.finalize());
        if expected.is_some_and(|wanted| wanted != id) {
            return Err("La copia de Drive no coincide con el libro original. No se reemplazó ningún archivo.".into());
        }
        let destination = path(root, &id, format)?;
        if destination.exists() {
            if hash_file(&destination)? != id {
                return Err(
                    "Ya existe un archivo local dañado. Se conserva para recuperarlo.".into(),
                );
            }
        } else {
            fs::rename(&temp, destination).map_err(|e| e.to_string())?;
        }
        Ok((id, size))
    })();
    let _ = fs::remove_file(&temp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_formats_share_the_registry_and_keep_safe_extensions() {
        let definitions = definitions();
        let unique: std::collections::HashSet<_> =
            definitions.iter().map(|entry| &entry.id).collect();
        assert_eq!(unique.len(), definitions.len());
        for format in supported_extensions() {
            assert!(format
                .bytes()
                .all(|character| character.is_ascii_alphanumeric()));
            assert!(valid_format(format));
            assert_ne!(mime_type(format), "application/octet-stream");
        }
        assert!(!valid_format("mobi"));
        assert!(!valid_format("azw3"));
        assert_eq!(
            mime_type("docx"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
    }
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!("lector-test-{}", uuid::Uuid::new_v4()))
    }
    fn cleanup(dir: PathBuf) {
        for item in fs::read_dir(&dir).unwrap() {
            fs::remove_file(item.unwrap().path()).unwrap();
        }
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn transfer_recovers_identical_book_and_keeps_duplicates() {
        let dir = root();
        let bytes = b"Un libro original para la prueba.";
        let (id, size) = receive(&dir, "txt", &bytes[..], None, || false).unwrap();
        assert_eq!(size, bytes.len() as u64);
        assert_eq!(hash_file(&path(&dir, &id, "txt").unwrap()).unwrap(), id);
        assert_eq!(
            receive(&dir, "txt", &bytes[..], Some(&id), || false)
                .unwrap()
                .0,
            id
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        cleanup(dir);
    }
    #[test]
    fn damaged_remote_copy_and_cancellation_do_not_overwrite_books() {
        let dir = root();
        let (id, _) = receive(&dir, "txt", &b"original"[..], None, || false).unwrap();
        assert!(receive(&dir, "txt", &b"different"[..], Some(&id), || false).is_err());
        assert!(receive(&dir, "txt", &b"new"[..], None, || true).is_err());
        assert_eq!(
            fs::read(path(&dir, &id, "txt").unwrap()).unwrap(),
            b"original"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        cleanup(dir);
    }
    #[test]
    fn unsafe_paths_and_formats_are_rejected() {
        let dir = root();
        assert!(path(&dir, "../../state", "txt").is_err());
        assert!(path(&dir, &"a".repeat(64), "../vault").is_err());
        assert!(receive(&dir, "exe", &b"x"[..], None, || false).is_err());
        assert!(!dir.exists());
    }
    #[test]
    fn streams_larger_than_the_previous_limit_are_saved_and_verified() {
        let dir = root();
        let size = 100_000_001;
        let (id, received) =
            receive(&dir, "txt", std::io::repeat(42).take(size), None, || false).unwrap();
        assert_eq!(received, size);
        let file = path(&dir, &id, "txt").unwrap();
        assert_eq!(fs::metadata(&file).unwrap().len(), size);
        assert_eq!(hash_file(&file).unwrap(), id);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        cleanup(dir);
    }
}

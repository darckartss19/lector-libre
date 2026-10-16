// Portable snapshots contain reader metadata and content-addressed books only.
// Credentials, speech models and application logs never enter this archive.
use crate::book_files;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[derive(Default)]
pub struct BackupLock(Mutex<()>);

// Límite de metadatos por manifiesto de copia: 256 MiB. No hay tope de
// libros originales, archivos de la copia ni conteo de libros.
const MANIFEST_MAX: u64 = 256 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileRecord {
    id: String,
    format: String,
    path: String,
    sha256: String,
    size: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    kind: String,
    #[serde(rename = "createdAt")]
    created_at: u64,
    library: Value,
    files: Vec<FileRecord>,
}
const KIND: &str = "lector-libre-backup";
const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn date_stamp(ms: u64) -> String {
    let z = (ms / 86_400_000) as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}
fn secret(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "access_token"
            | "refresh_token"
            | "id_token"
            | "client_secret"
            | "client_id"
            | "oauth"
            | "oauthclient"
            | "oauth_client"
            | "vault"
            | "drive.vault"
    )
}
fn scrub(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|key, _| !secret(key));
            for v in map.values_mut() {
                scrub(v);
            }
        }
        Value::Array(items) => {
            for v in items {
                scrub(v);
            }
        }
        _ => (),
    }
}
fn safe_integer(value: &Value) -> bool {
    value.as_u64().is_some_and(|n| n <= SAFE_INTEGER)
}
fn nonempty(value: &Value) -> bool {
    value.as_str().is_some_and(|s| !s.trim().is_empty())
}
fn drive_id(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 200
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    })
}
// JavaScript limits strings in UTF-16 units, not UTF-8 bytes. Preserve valid
// Unicode metadata and apply the same whitespace/control rules as the UI.
fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| {
        matches!(c as u32,
            0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a |
            0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
    })
}
fn valid_language(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.encode_utf16().count() <= 200
            && !s
                .chars()
                .any(|c| matches!(c as u32, 0x0000..=0x001f | 0x007f))
    })
}
fn validate_library_filters(value: &Value) -> Result<(), String> {
    let fields = value
        .as_object()
        .ok_or("Los filtros de la copia no son válidos.")?;
    for (key, value) in fields {
        let text = value
            .as_str()
            .ok_or("Un filtro de la copia no es válido.")?;
        if text.chars().any(
            |c| matches!(c as u32, 0x0000..=0x0008 | 0x000b..=0x000c | 0x000e..=0x001f | 0x007f),
        ) {
            return Err("Un filtro de la copia no es válido.".into());
        }
        let text = js_trim(text);
        let options: Option<&[&str]> = match key.as_str() {
            "section" => Some(&[
                "all",
                "pinned",
                "recent",
                "reading",
                "finished",
                "recentlyRead",
                "unread",
            ]),
            "sort" => Some(&["pin", "read", "added", "title", "author", "series"]),
            "format" => None,
            "readingState" => Some(&["unread", "reading", "finished"]),
            "availability" => Some(&["local", "cloud", "missing"]),
            "genre" | "series" | "collection" | "search" | "author" | "language" => None,
            _ => return Err("La copia contiene un filtro desconocido.".into()),
        };
        if !text.is_empty() {
            if key == "format"
                && !book_files::catalog_extensions().contains(&text.to_lowercase().as_str())
            {
                return Err("El filtro contiene un formato desconocido.".into());
            }
            let token = if key == "format" {
                text.to_lowercase()
            } else {
                text.to_owned()
            };
            if options.is_some_and(|options| !options.contains(&token.as_str())) {
                return Err("Un filtro de la copia no es válido.".into());
            }
            if key == "language" && text != "unknown" && !valid_language(&json!(text)) {
                return Err("El idioma de un filtro no es válido.".into());
            }
        }
    }
    Ok(())
}
fn validate_saved_views(value: &Value) -> Result<(), String> {
    let views = value
        .as_array()
        .ok_or("Las vistas guardadas de la copia no son válidas.")?;
    let mut ids = HashSet::new();
    for view in views {
        let fields = view
            .as_object()
            .ok_or("Una vista guardada de la copia no es válida.")?;
        if fields
            .keys()
            .any(|key| !["id", "name", "filters"].contains(&key.as_str()))
            || !drive_id(&view["id"])
            || !ids.insert(view["id"].as_str().unwrap())
            || !view["name"].as_str().is_some_and(|name| {
                name.encode_utf16().count() <= 100
                    && !js_trim(name).is_empty()
                    && !name
                        .chars()
                        .any(|c| matches!(c as u32, 0x0000..=0x001f | 0x007f))
            })
        {
            return Err(
                "Una vista guardada de la copia no es válida o tiene un identificador repetido."
                    .into(),
            );
        }
        if let Some(filters) = view.get("filters") {
            validate_library_filters(filters)?;
        }
    }
    Ok(())
}
fn validate_locator(value: &Value) -> Result<(), String> {
    if !(value.is_null() || value.is_object() || value.is_string())
        || value
            .get("offset")
            .is_some_and(|offset| !safe_integer(offset))
    {
        return Err("La posición de lectura de la copia no es válida.".into());
    }
    Ok(())
}
fn validate_preferences(p: &Value) -> Result<(), String> {
    if !p.is_object() {
        return Err("Las preferencias de la copia no son válidas.".into());
    }
    for (key, options) in [
        ("view", &["covers", "spines", "list"][..]),
        (
            "theme",
            &[
                "light", "sepia", "mist", "dark", "graphite", "midnight", "forest", "plum",
                "ember", "amoled",
            ][..],
        ),
        (
            "pageTheme",
            &[
                "auto", "light", "sepia", "mist", "dark", "graphite", "midnight", "forest", "plum",
                "ember", "amoled",
            ][..],
        ),
        ("font", &["serif", "book", "sans", "wide", "mono"][..]),
        ("textAlign", &["left", "justify"][..]),
        ("uiLanguage", &["es", "en", "pt"][..]),
        (
            "speechLanguage",
            &["auto", "es", "en", "pt", "fr", "de", "it"][..],
        ),
        ("spineStyle", &["illustrated", "color", "classic"][..]),
        ("readingMode", &["scroll", "page", "spread", "vertical"][..]),
        ("pdfView", &["original", "text"][..]),
        (
            "pdfZoom",
            &["fit-page", "fit-width", "1", "1.25", "1.5", "2", "3"][..],
        ),
        ("pdfLayout", &["page", "spread"][..]),
    ] {
        if let Some(value) = p.get(key) {
            if !value.as_str().is_some_and(|s| options.contains(&s)) {
                return Err("Una preferencia de la copia no es válida.".into());
            }
        }
    }
    for (key, min, max) in [
        ("fontSize", 12.0, 40.0),
        ("lineHeight", 1.2, 2.6),
        ("pageWidth", 480.0, 1200.0),
        ("pagePadding", 8.0, 80.0),
        ("paragraphSpacing", 0.3, 2.5),
        ("letterSpacing", 0.0, 0.12),
        ("rate", 0.5, 3.0),
    ] {
        if let Some(value) = p.get(key) {
            if !value.as_f64().is_some_and(|n| n >= min && n <= max) {
                return Err("Una preferencia numérica de la copia no es válida.".into());
            }
        }
    }
    for key in ["downloadCloud", "firstLineIndent"] {
        if p.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err("Una preferencia de la copia no es válida.".into());
        }
    }
    if p.get("voice").is_some_and(|v| !v.is_string()) {
        return Err("La preferencia de voz no es válida.".into());
    }
    if let Some(views) = p.get("savedViews") {
        validate_saved_views(views)?;
    }
    Ok(())
}
fn validate_annotations(items: &Value) -> Result<(), String> {
    let mut ids = HashSet::new();
    for a in items
        .as_array()
        .ok_or("Las anotaciones de la copia no son válidas.")?
    {
        let valid_type = a["type"]
            .as_str()
            .is_some_and(|s| ["bookmark", "highlight", "note"].contains(&s));
        if !drive_id(&a["id"])
            || !ids.insert(a["id"].as_str().unwrap().to_owned())
            || !valid_type
            || !nonempty(&a["chapter"])
            || !safe_integer(&a["start"])
            || !safe_integer(&a["end"])
            || a["end"].as_u64() < a["start"].as_u64()
            || (a["type"] != "bookmark" && a["end"] == a["start"])
            || !a["color"]
                .as_str()
                .is_some_and(|s| ["yellow", "green", "blue", "pink"].contains(&s))
            || !a["deleted"].is_boolean()
            || ["quote", "note", "label"]
                .iter()
                .any(|key| !a[*key].is_string())
            || !safe_integer(&a["createdAt"])
            || !safe_integer(&a["updatedAt"])
            || a["updatedAt"].as_u64() < a["createdAt"].as_u64()
        {
            return Err("Una anotación de la copia no es válida.".into());
        }
    }
    Ok(())
}
fn validate_library(value: &Value) -> Result<HashMap<String, String>, String> {
    if value["version"] != 1 || !value["preferences"].is_object() || !value["books"].is_array() {
        return Err("La biblioteca de la copia no es válida.".into());
    }
    validate_preferences(&value["preferences"])?;
    if let Some(folder) = value.get("driveFolder") {
        if !folder.is_object() || !drive_id(&folder["id"]) || !folder["name"].is_string() {
            return Err("La carpeta de Drive de la copia no es válida.".into());
        }
    }
    let mut books = HashMap::new();
    let mut pins = HashSet::new();
    for b in value["books"].as_array().unwrap() {
        let id = b["id"]
            .as_str()
            .ok_or("Falta el identificador del libro.")?;
        let format = b["format"].as_str().ok_or("Falta el formato del libro.")?;
        if !book_files::valid_id(id)
            || !book_files::valid_format(format)
            || books.insert(id.into(), format.into()).is_some()
        {
            return Err("Identificador, formato o libro repetido no válido.".into());
        }
        if !b["title"].as_str().is_some_and(|s| !s.trim().is_empty())
            || !b["author"].is_string()
            || !b["genres"]
                .as_array()
                .is_some_and(|a| a.iter().all(Value::is_string))
            || !(b["cover"].is_null() || b["cover"].is_string())
            || !safe_integer(&b["addedAt"])
            || !(b["lastReadAt"].is_null() || safe_integer(&b["lastReadAt"]))
            || !(b["pinOrder"].is_null() || safe_integer(&b["pinOrder"]))
            || !b["progress"]
                .as_f64()
                .is_some_and(|p| (0.0..=1.0).contains(&p))
            || !(b["audioPosition"].is_null() || b["audioPosition"].is_object())
        {
            return Err("Los metadatos de un libro no son válidos.".into());
        }
        validate_locator(&b["locator"])?;
        if b.get("language")
            .is_some_and(|language| !valid_language(language))
        {
            return Err("El idioma del libro de la copia no es válido.".into());
        }
        if let Some(pin) = b["pinOrder"].as_u64() {
            if !pins.insert(pin) {
                return Err("La copia contiene posiciones fijadas repetidas.".into());
            }
        }
        if b["lastReadAt"].is_null() && (b["progress"] != 0 || !b["locator"].is_null()) {
            return Err("La posición de lectura de la copia no es válida.".into());
        }
        if !b["importedMetadata"].is_object()
            || !nonempty(&b["importedMetadata"]["title"])
            || !b["importedMetadata"]["author"].is_string()
        {
            return Err("Los metadatos originales del libro no son válidos.".into());
        }
        if b.get("series").is_some_and(|v| !v.is_string())
            || b.get("seriesIndex")
                .is_some_and(|v| !v.is_null() && !v.as_f64().is_some_and(|n| n >= 0.0))
        {
            return Err("La saga de la copia no es válida.".into());
        }
        if let Some(collections) = b.get("collections") {
            if !collections
                .as_array()
                .is_some_and(|a| a.iter().all(nonempty))
            {
                return Err("Las colecciones de la copia no son válidas.".into());
            }
        }
        if let Some(items) = b.get("annotations") {
            validate_annotations(items)?;
        }
        if let Some(position) = b.get("audioPosition").filter(|v| !v.is_null()) {
            if !position.is_object()
                || !nonempty(&position["chapter"])
                || !safe_integer(&position["offset"])
                || !nonempty(&position["voice"])
                || !position["rate"].as_f64().is_some_and(|n| n > 0.0)
            {
                return Err("La posición de audio de la copia no es válida.".into());
            }
        }
        if let Some(source) = b.get("driveSource") {
            if !source.is_object()
                || !drive_id(&source["fileId"])
                || !drive_id(&source["folderId"])
                || source["sha256"] != id
            {
                return Err("Una referencia de Drive no es válida.".into());
            }
        }
    }
    if let Some(registers) = value.get("registers") {
        for (key, record) in registers
            .as_object()
            .ok_or("Registros de biblioteca no válidos.")?
        {
            let parts: Vec<String> =
                serde_json::from_str(key).map_err(|_| "Registro de biblioteca no válido.")?;
            if parts.len() != 2
                || !(parts[0].is_empty() || book_files::valid_id(&parts[0]))
                || parts[1].is_empty()
                || secret(&parts[1])
                || !record.is_object()
                || !safe_integer(&record["time"])
                || !safe_integer(&record["counter"])
                || !record["device"].as_str().is_some_and(|s| !s.is_empty())
            {
                return Err("Registro de biblioteca no válido.".into());
            }
            match parts[1].as_str() {
                "preferences" => validate_preferences(&record["value"])?,
                "language" if !valid_language(&record["value"]) => {
                    return Err("El idioma de un registro de la copia no es válido.".into());
                }
                "locator" => validate_locator(&record["value"])?,
                _ => (),
            }
        }
    }
    Ok(books)
}
fn portable(mut value: Value) -> Result<Value, String> {
    let map = value.as_object_mut().ok_or("Biblioteca no válida.")?;
    map.retain(|key, _| {
        matches!(
            key.as_str(),
            "version"
                | "preferences"
                | "books"
                | "deviceId"
                | "registers"
                | "conflicts"
                | "driveFolder"
                | "lastSync"
        )
    });
    scrub(&mut value);
    validate_library(&value)?;
    Ok(value)
}

// serde_json normally accepts duplicate keys. Reject them before validation so
// the archive has one unambiguous interpretation.
struct StrictValue(Value);
impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = StrictValue;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON sin claves repetidas")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(StrictValue(json!(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| StrictValue(Value::Number(n)))
                    .ok_or_else(|| E::custom("Número no válido"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::String(v.into())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::String(v)))
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Null))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(StrictValue(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(v) = seq.next_element::<StrictValue>()? {
                    values.push(v.0);
                }
                Ok(StrictValue(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some((key, v)) = map.next_entry::<String, StrictValue>()? {
                    if values.insert(key, v.0).is_some() {
                        return Err(serde::de::Error::custom("Clave JSON repetida"));
                    }
                }
                Ok(StrictValue(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

/// Lee el manifiesto con un límite acotado: `take(max + 1)` para la lectura
/// real y un byte extra para detectar que hay más datos. Así se rechaza
/// incluso un prefijo JSON válido seguido de espacios en blanco sobrantes,
/// que un `take(MAX)` aplicado solo al parser aceptaría sin darse cuenta.
fn read_bounded(reader: &mut impl Read, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > max as usize {
        return Err("El manifiesto supera el límite de 256 MiB de metadatos.".into());
    }
    let mut extra = [0u8; 1];
    if reader.read(&mut extra).map_err(|e| e.to_string())? > 0 {
        return Err("El manifiesto supera el límite de 256 MiB de metadatos.".into());
    }
    Ok(bytes)
}

/// Escritura que no almacena nada: solo cuenta los bytes de una serialización.
struct Discard;
impl Write for Discard {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Envuelve una escritura contando los bytes y fallando al sobrepasar `max`.
struct CountingWriter<W> {
    inner: W,
    count: u64,
    max: u64,
}

impl<W: Write> CountingWriter<W> {
    fn new(inner: W, max: u64) -> Self {
        Self {
            inner,
            count: 0,
            max,
        }
    }
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.count += n as u64;
        if self.count > self.max {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "El manifiesto supera el límite de 256 MiB de metadatos.",
            ));
        }
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// Longitud en bytes de la serialización JSON de `value`, acotada a `max`,
/// sin escribir nada en disco.
fn serialized_len<T: Serialize>(value: &T, max: u64) -> Result<u64, String> {
    let mut sink = CountingWriter {
        inner: Discard,
        count: 0,
        max,
    };
    serde_json::to_writer(&mut sink, value).map_err(|e| e.to_string())?;
    if sink.count > max {
        return Err("El manifiesto supera el límite de 256 MiB de metadatos.".into());
    }
    Ok(sink.count)
}

fn copy_hashed(mut input: impl Read, mut output: impl Write) -> Result<(String, u64), String> {
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut chunk = [0u8; 65536];
    loop {
        let n = input.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        output.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
        hash.update(&chunk[..n]);
        size += n as u64;
    }
    Ok((format!("{:x}", hash.finalize()), size))
}
fn export_to_limited(
    root: &Path,
    destination: &Path,
    value: Value,
    max: u64,
) -> Result<Value, String> {
    let library = portable(crate::state_store::portable_covers(root, value)?)?;
    let books = validate_library(&library)?;
    let remote_ids: HashSet<&str> = library["books"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|book| book.get("driveSource").is_some())
        .filter_map(|book| book["id"].as_str())
        .collect();
    let mut files = Vec::new();
    for (id, format) in &books {
        let path = book_files::path(&root.join("books"), id, format)?;
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_file() {
                    return Err("Un archivo local no es un libro regular.".into());
                }
                files.push(FileRecord {
                    id: id.clone(),
                    format: format.clone(),
                    path: format!("books/{id}.{format}"),
                    sha256: id.clone(),
                    size: meta.len(),
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if !remote_ids.contains(id.as_str()) {
                    let title = library["books"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|book| book["id"] == *id)
                        .and_then(|book| book["title"].as_str())
                        .unwrap_or(id);
                    return Err(format!("No se pudo crear una copia completa: falta el archivo de «{title}». Recupera el archivo original y vuelve a intentarlo. La copia anterior se conserva."));
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let local = files.len();
    let total = books.len();
    let manifest = Manifest {
        version: 1,
        kind: KIND.into(),
        created_at: now(),
        library,
        files,
    };
    // Simetría de exportación: acota la serialización del manifiesto antes de
    // tocar el destino ni crear el temporal, de modo que una copia que esta
    // app no puede restaurar nunca se escribe.
    let _ = serialized_len(&manifest, max)?;
    let parent = destination.parent().ok_or("Destino no válido.")?;
    let temporary = parent.join(format!(".lector-backup-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        let mut zip = ZipWriter::new(output);
        zip.start_file(
            "manifest.json",
            SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .large_file(true),
        )
        .map_err(|e| e.to_string())?;
        // Segundo acotado mientras se escribe: si algo sobrepasa, se aborta,
        // se elimina el temporal y se conserva el destino previo.
        let mut counted = CountingWriter::new(&mut zip, max);
        serde_json::to_writer(&mut counted, &manifest).map_err(|e| e.to_string())?;
        for record in &manifest.files {
            zip.start_file(
                &record.path,
                SimpleFileOptions::default()
                    .compression_method(if book_files::already_compressed(&record.format) {
                        CompressionMethod::Stored
                    } else {
                        CompressionMethod::Deflated
                    })
                    .large_file(record.size >= u32::MAX as u64),
            )
            .map_err(|e| e.to_string())?;
            let path = book_files::path(&root.join("books"), &record.id, &record.format)?;
            let (hash, size) =
                copy_hashed(fs::File::open(path).map_err(|e| e.to_string())?, &mut zip)?;
            if hash != record.sha256 || size != record.size {
                return Err(
                    "Un libro local cambió o está dañado. La copia anterior se conserva.".into(),
                );
            }
        }
        let finished = zip.finish().map_err(|e| e.to_string())?;
        finished.sync_all().map_err(|e| e.to_string())?;
        drop(finished);
        let previous = parent.join(format!(".lector-backup-{}.old", uuid::Uuid::new_v4()));
        let exists = destination.exists();
        if exists {
            let meta = fs::symlink_metadata(destination).map_err(|e| e.to_string())?;
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err("Destino no válido.".into());
            }
            fs::rename(destination, &previous).map_err(|e| e.to_string())?;
        }
        if let Err(e) = fs::rename(&temporary, destination) {
            if exists {
                let _ = fs::rename(&previous, destination);
            }
            return Err(e.to_string());
        }
        if exists {
            let _ = fs::remove_file(previous);
        }
        Ok(
            json!({"books":total,"filesExported":local,"remoteBooks":total-local,"bytes":fs::metadata(destination).map_err(|e|e.to_string())?.len()}),
        )
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn export_to(root: &Path, destination: &Path, value: Value) -> Result<Value, String> {
    export_to_limited(root, destination, value, MANIFEST_MAX)
}

struct Stage {
    path: PathBuf,
    root: PathBuf,
}
impl Stage {
    fn new(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let path = root.join(format!(".restore-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self { path, root })
    }
}
impl Drop for Stage {
    fn drop(&mut self) {
        if self.path.parent() == Some(self.root.as_path())
            && self
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|s| s.starts_with(".restore-"))
            && fs::symlink_metadata(&self.path)
                .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
        {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
fn check_central_names(file: &mut fs::File, start: u64, expected: usize) -> Result<(), String> {
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut names = HashSet::new();
    loop {
        let mut signature = [0u8; 4];
        file.read_exact(&mut signature).map_err(|e| e.to_string())?;
        match u32::from_le_bytes(signature) {
            0x06054b50 | 0x06064b50 => break,
            0x02014b50 => (),
            _ => return Err("Directorio ZIP no válido.".into()),
        }
        let mut header = [0u8; 42];
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        let len = u16::from_le_bytes([header[24], header[25]]) as usize;
        let extra = u16::from_le_bytes([header[26], header[27]]) as i64;
        let comment = u16::from_le_bytes([header[28], header[29]]) as i64;
        let mut name = vec![0; len];
        file.read_exact(&mut name).map_err(|e| e.to_string())?;
        if !names.insert(name) {
            return Err("La copia contiene rutas ZIP repetidas.".into());
        }
        file.seek(SeekFrom::Current(extra + comment))
            .map_err(|e| e.to_string())?;
    }
    if names.len() != expected {
        return Err("El índice ZIP no coincide.".into());
    }
    Ok(())
}
fn import_from_limited(root: &Path, source: &Path, max: u64) -> Result<Value, String> {
    let mut archive = ZipArchive::new(fs::File::open(source).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if archive.offset() != 0 {
        return Err("La copia ZIP no es compatible.".into());
    }
    check_central_names(
        &mut fs::File::open(source).map_err(|e| e.to_string())?,
        archive.central_directory_start(),
        archive.len(),
    )?;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        let kind = file.unix_mode().unwrap_or(0) & 0o170000;
        if !file.is_file()
            || file.is_symlink()
            || !(kind == 0 || kind == 0o100000)
            || file.enclosed_name().is_none()
            || file.name().contains('\\')
            || !names.insert(file.name().to_string())
        {
            return Err("La copia contiene una ruta o enlace no válido.".into());
        }
    }
    let manifest_bytes = {
        let mut manifest_file = archive
            .by_name("manifest.json")
            .map_err(|_| "Falta manifest.json en la copia.")?;
        // Tamaño declarado (descomprimido) del manifiesto, antes de leerlo.
        if manifest_file.size() > max {
            return Err("El manifiesto supera el límite de 256 MiB de metadatos.".into());
        }
        // Lectura real acotada: rechaza también los espacios en blanco sobrantes
        // tras un prefijo JSON válido.
        read_bounded(&mut manifest_file, max)?
    };
    let strict: StrictValue = serde_json::from_reader(manifest_bytes.as_slice())
        .map_err(|_| "El manifiesto JSON no es válido o contiene claves repetidas.")?;
    let manifest: Manifest = serde_json::from_value(strict.0)
        .map_err(|_| "El manifiesto de la copia no es compatible.")?;
    if manifest.version != 1 || manifest.kind != KIND {
        return Err("Esta copia no es compatible con Lector libre.".into());
    }
    let books = validate_library(&manifest.library)?;
    let mut listed = HashSet::new();
    for record in &manifest.files {
        if !book_files::valid_id(&record.id)
            || !book_files::valid_format(&record.format)
            || record.sha256 != record.id
            || record.path != format!("books/{}.{}", record.id, record.format)
            || books.get(&record.id) != Some(&record.format)
            || !listed.insert(record.path.clone())
            || !names.contains(&record.path)
            || archive
                .by_name(&record.path)
                .map_err(|e| e.to_string())?
                .size()
                != record.size
        {
            return Err("Los archivos de la copia no coinciden con su manifiesto.".into());
        }
    }
    if names.len() != listed.len() + 1 || !names.contains("manifest.json") {
        return Err("La copia contiene archivos desconocidos.".into());
    }
    let stage = Stage::new(root)?;
    let books_root = root.join("books");
    for record in &manifest.files {
        let staged = stage.path.join(format!("{}.{}", record.id, record.format));
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(staged)
            .map_err(|e| e.to_string())?;
        let (hash, size) = copy_hashed(
            archive.by_name(&record.path).map_err(|e| e.to_string())?,
            &mut output,
        )?;
        output.sync_all().map_err(|e| e.to_string())?;
        if hash != record.sha256 || size != record.size {
            return Err("Un libro de la copia está dañado. No se restauró ningún archivo.".into());
        }
        let destination = book_files::path(&books_root, &record.id, &record.format)?;
        if destination.exists() {
            let metadata = fs::symlink_metadata(&destination).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || book_files::hash_file(&destination)? != record.id
            {
                return Err(
                    "Un original local está dañado o enlazado. Se conserva para recuperarlo."
                        .into(),
                );
            }
        }
    }
    fs::create_dir_all(&books_root).map_err(|e| e.to_string())?;
    let mut installed = Vec::new();
    let mut reused = 0;
    let commit = (|| {
        for record in &manifest.files {
            let destination = book_files::path(&books_root, &record.id, &record.format)?;
            let staged = stage.path.join(format!("{}.{}", record.id, record.format));
            match fs::hard_link(staged, &destination) {
                Ok(()) => installed.push(destination),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if book_files::hash_file(&destination)? != record.id {
                        return Err("Un original cambió durante la restauración.".into());
                    }
                    reused += 1;
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    })();
    if let Err(e) = commit {
        for path in &installed {
            let _ = fs::remove_file(path);
        }
        return Err(e);
    }
    Ok(
        json!({"library":manifest.library,"filesImported":installed.len(),"filesReused":reused,"remoteBooks":books.len()-manifest.files.len()}),
    )
}

fn import_from(root: &Path, source: &Path) -> Result<Value, String> {
    import_from_limited(root, source, MANIFEST_MAX)
}

#[tauri::command]
pub async fn export_backup(app: tauri::AppHandle, value: Value) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupLock>();
        let _lock = state.0.lock().map_err(|e| e.to_string())?;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Copia de Lector libre", &["zip"])
            .set_file_name(format!("Lector-libre-{}.zip", date_stamp(now())))
            .blocking_save_file()
        else {
            return Ok(None);
        };
        #[cfg(target_os = "android")]
        return crate::selected_document::staged(&app, |temporary| {
            let result = export_to(&crate::directory(&app)?, temporary, value)?;
            crate::selected_document::copy_out(&app, file, temporary)?;
            Ok(Some(result))
        });
        #[cfg(not(target_os = "android"))]
        {
            let mut destination = file.into_path().map_err(|e| e.to_string())?;
            if destination
                .extension()
                .and_then(|s| s.to_str())
                .is_none_or(|s| !s.eq_ignore_ascii_case("zip"))
            {
                destination.set_extension("zip");
            }
            export_to(&crate::directory(&app)?, &destination, value).map(Some)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn import_backup(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupLock>();
        let _lock = state.0.lock().map_err(|e| e.to_string())?;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Copia de Lector libre", &["zip"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        #[cfg(target_os = "android")]
        return crate::selected_document::staged(&app, |temporary| {
            let mut target = fs::File::create(temporary).map_err(|e| e.to_string())?;
            std::io::copy(
                &mut crate::selected_document::open(&app, file)?,
                &mut target,
            )
            .map_err(|e| e.to_string())?;
            target.sync_all().map_err(|e| e.to_string())?;
            drop(target);
            import_from(&crate::directory(&app)?, temporary).map(Some)
        });
        #[cfg(not(target_os = "android"))]
        import_from(
            &crate::directory(&app)?,
            &file.into_path().map_err(|e| e.to_string())?,
        )
        .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Root(PathBuf);
    impl Root {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("lector-backup-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Root {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("lector-backup-test-"));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn book(id: &str, format: &str) -> Value {
        json!({"id":id,"format":format,"title":"Mi libro","author":"Autora","genres":["Ficción"],"cover":null,"series":"","seriesIndex":null,"importedMetadata":{"title":"Mi libro","author":"Autora"},"addedAt":1,"lastReadAt":null,"pinOrder":null,"progress":0,"locator":null,"audioPosition":null,"bookmarks":[{"chapter":"c1","offset":30}]})
    }
    fn library(books: Vec<Value>) -> Value {
        json!({"version":1,"preferences":{"view":"covers","theme":"midnight"},"books":books,"registers":{},"deviceId":"fixture-device"})
    }
    fn manifest(books: Vec<Value>, records: Vec<(&str, &str, &[u8])>) -> Manifest {
        Manifest {
            version: 1,
            kind: KIND.into(),
            created_at: 1,
            library: library(books),
            files: records
                .into_iter()
                .map(|(id, format, bytes)| FileRecord {
                    id: id.into(),
                    format: format.into(),
                    path: format!("books/{id}.{format}"),
                    sha256: id.into(),
                    size: bytes.len() as u64,
                })
                .collect(),
        }
    }
    fn zip_file(path: &Path, manifest: &Manifest, entries: Vec<(&str, &[u8])>) {
        let mut writer = ZipWriter::new(fs::File::create(path).unwrap());
        writer
            .start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        serde_json::to_writer(&mut writer, manifest).unwrap();
        for (name, bytes) in entries {
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }
    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    fn no_stage(root: &Path) {
        assert!(fs::read_dir(root).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_str()
            .unwrap()
            .starts_with(".restore-")));
    }
    #[test]
    fn backup_rejects_a_missing_book_without_remote_source_and_preserves_the_previous_zip() {
        let root = Root::new();
        let id = hash(b"missing book");
        let destination = root.0.join("backup.zip");
        fs::write(&destination, b"previous backup").unwrap();
        let result = export_to(&root.0, &destination, library(vec![book(&id, "txt")]));
        assert!(result.is_err());
        assert_eq!(fs::read(destination).unwrap(), b"previous backup");
    }
    #[test]
    fn backup_round_trip_is_additive_keeps_remote_references_and_reuses_identical_files() {
        let source = Root::new();
        let destination = Root::new();
        let bytes = b"Texto original completo con tildes.";
        let (id, _) =
            book_files::receive(&source.0.join("books"), "txt", &bytes[..], None, || false)
                .unwrap();
        let remote_id = "a".repeat(64);
        let mut remote = book(&remote_id, "epub");
        remote["driveSource"] =
            json!({"fileId":"remote_file","folderId":"remote_folder","sha256":remote_id});
        let mut value = library(vec![book(&id, "txt"), remote]);
        value["refresh_token"] = json!("private");
        value["preferences"]["client_secret"] = json!("private");
        value["books"][0]["access_token"] = json!("private");
        let key = serde_json::to_string(&vec![&id, "bookmarks"]).unwrap();
        value["registers"][key] =
            json!({"time":1,"counter":0,"device":"fixture","value":[{"chapter":"c1","offset":30}]});
        let target = source.0.join("copy.zip");
        let summary = export_to(&source.0, &target, value).unwrap();
        assert_eq!(summary["filesExported"], 1);
        assert_eq!(summary["remoteBooks"], 1);
        fs::write(
            destination.0.join("state.json"),
            b"existing state must stay unchanged",
        )
        .unwrap();
        let (other, _) = book_files::receive(
            &destination.0.join("books"),
            "txt",
            &b"Otro libro"[..],
            None,
            || false,
        )
        .unwrap();
        let restored = import_from(&destination.0, &target).unwrap();
        assert_eq!(restored["filesImported"], 1);
        assert_eq!(restored["remoteBooks"], 1);
        assert_eq!(
            restored["library"]["books"][1]["driveSource"]["fileId"],
            "remote_file"
        );
        assert_eq!(
            restored["library"]["books"][0]["bookmarks"][0]["offset"],
            30
        );
        assert_eq!(restored["library"]["deviceId"], "fixture-device");
        assert!(restored["library"]["refresh_token"].is_null());
        assert!(restored["library"]["preferences"]["client_secret"].is_null());
        assert!(restored["library"]["books"][0]["access_token"].is_null());
        assert_eq!(
            fs::read(destination.0.join("state.json")).unwrap(),
            b"existing state must stay unchanged"
        );
        assert!(
            book_files::path(&destination.0.join("books"), &other, "txt")
                .unwrap()
                .is_file()
        );
        let second = import_from(&destination.0, &target).unwrap();
        assert_eq!(second["filesImported"], 0);
        assert_eq!(second["filesReused"], 1);
        assert_eq!(
            fs::read_dir(destination.0.join("books")).unwrap().count(),
            2
        );
        no_stage(&destination.0);
    }
    #[test]
    fn backup_round_trip_retains_reading_mode_saved_views_language_and_page_offset() {
        let source = Root::new();
        let destination = Root::new();
        let bytes = b"Una lectura de prueba con posicion de pagina.";
        let (id, _) =
            book_files::receive(&source.0.join("books"), "txt", &bytes[..], None, || false)
                .unwrap();
        let mut record = book(&id, "txt");
        record["language"] = json!("es-MX");
        record["author"] = json!(format!("Antología de {}\nInvitada", "Autora ".repeat(60)));
        record["lastReadAt"] = json!(2);
        record["progress"] = json!(0.4);
        record["locator"] = json!({"chapter":"text","fraction":0.4,"offset":37});
        let mut value = library(vec![record]);
        value["preferences"]["readingMode"] = json!("spread");
        value["preferences"]["savedViews"] = json!([
            {"id":"view-one","name":"Aventuras \u{1f4da} de Ángela","filters":{
                "section":"all","genre":"Aventuras","series":"Viajes","collection":"Verano",
                "search":"tarde","sort":"title","author":value["books"][0]["author"],
                "language":"es-MX","format":"txt","readingState":"reading","availability":"local"
            }},
            {"id":"view-two","name":"Historial completo","filters":{"section":"recentlyRead"}}
        ]);
        let pref_key = serde_json::to_string(&["", "preferences"]).unwrap();
        let language_key = serde_json::to_string(&[id.as_str(), "language"]).unwrap();
        let locator_key = serde_json::to_string(&[id.as_str(), "locator"]).unwrap();
        value["registers"][pref_key] =
            json!({"time":3,"counter":0,"device":"fixture","value":value["preferences"]});
        value["registers"][language_key] =
            json!({"time":3,"counter":0,"device":"fixture","value":"es-MX"});
        value["registers"][locator_key] =
            json!({"time":3,"counter":0,"device":"fixture","value":value["books"][0]["locator"]});
        let archive = source.0.join("reading-tools.zip");
        export_to(&source.0, &archive, value.clone()).unwrap();
        let restored = import_from(&destination.0, &archive).unwrap();
        assert_eq!(restored["library"], value);
        assert_eq!(restored["filesImported"], 1);
        assert_eq!(
            restored["library"]["preferences"]["savedViews"][0]["name"],
            "Aventuras \u{1f4da} de Ángela"
        );
        assert_eq!(restored["library"]["books"][0]["locator"]["offset"], 37);
        no_stage(&destination.0);
    }
    #[test]
    fn backup_accepts_legacy_positions_missing_languages_and_all_reading_modes() {
        let mut value = library(vec![book(&"a".repeat(64), "epub")]);
        assert!(validate_library(&value).is_ok());
        value["books"][0]["lastReadAt"] = json!(1);
        value["books"][0]["progress"] = json!(0.2);
        for locator in [
            json!({"chapter":"old","fraction":0.2}),
            json!("old-position"),
        ] {
            value["books"][0]["locator"] = locator;
            assert!(validate_library(&value).is_ok());
        }
        for mode in ["scroll", "page", "spread"] {
            value["preferences"]["readingMode"] = json!(mode);
            value["preferences"]["savedViews"] = json!([]);
            value["books"][0]["language"] = json!("");
            assert!(validate_library(&value).is_ok());
        }
        value["books"][0]["language"] = json!("Español");
        value["preferences"]["savedViews"] = json!([{"id":"legacy-view","name":"Vista antigua"}]);
        assert!(validate_library(&value).is_ok());
    }
    #[test]
    fn corrupt_saved_filters_language_and_page_offset_abort_before_restoring_files() {
        let source = Root::new();
        let target = Root::new();
        let bytes = b"Archivo integro para comprobar el contrato antes de restaurar.";
        let id = hash(bytes);
        let path = format!("books/{id}.txt");
        let filters = [
            json!({"localIds":[id]}),
            json!({"cloudIds":[id]}),
            json!({"filePath":"C:/private"}),
            json!({"__proto__":{"value":true}}),
            json!({"section":"unknown"}),
            json!({"sort":"random"}),
            json!({"format":"exe"}),
            json!({"readingState":"started"}),
            json!({"availability":"offline"}),
            json!({"author":false}),
            json!({"language":null}),
            json!({"search":"bad\u{0000}query"}),
        ];
        let mut cases = Vec::new();
        for filter in filters {
            let mut preferences = json!({"view":"covers"});
            preferences["savedViews"] = json!([{"id":"view","name":"Prueba","filters":filter}]);
            cases.push((preferences, None, None));
        }
        for views in [
            json!({"id":"not-an-array"}),
            json!([{"id":"view","name":"Prueba","filters":null}]),
            json!([{"id":"view","name":"A","filters":{}},{"id":"view","name":"B","filters":{}}]),
            json!([{"id":"view","name":"Prueba","filters":{},"path":"C:/private"}]),
            json!([{"id":"../view","name":"Prueba","filters":{}}]),
            json!([{"id":"view","name":"\u{feff}","filters":{}}]),
            json!([{"id":"view","name":"\nPrueba","filters":{}}]),
        ] {
            cases.push((json!({"view":"covers","savedViews":views}), None, None));
        }
        cases.push((json!({"view":"covers","readingMode":"three"}), None, None));
        for language in [json!(null), json!(7), json!("es\n"), json!("a".repeat(201))] {
            cases.push((json!({"view":"covers"}), Some(language), None));
        }
        for offset in [json!(-1), json!(1.5), json!("42"), json!(SAFE_INTEGER + 1)] {
            cases.push((json!({"view":"covers"}), None, Some(offset)));
        }
        fs::write(
            target.0.join("state.json"),
            b"conservar biblioteca existente",
        )
        .unwrap();
        for (preferences, language, offset) in cases {
            let mut m = manifest(vec![book(&id, "txt")], vec![(&id, "txt", bytes)]);
            m.library["preferences"] = preferences;
            if let Some(language) = language {
                m.library["books"][0]["language"] = language;
            }
            if let Some(offset) = offset {
                m.library["books"][0]["lastReadAt"] = json!(2);
                m.library["books"][0]["progress"] = json!(0.4);
                m.library["books"][0]["locator"] =
                    json!({"chapter":"text","fraction":0.4,"offset":offset});
            }
            let archive = source.0.join("invalid-tools.zip");
            zip_file(&archive, &m, vec![(&path, bytes)]);
            assert!(
                import_from(&target.0, &archive).is_err(),
                "must reject {:?}",
                m.library
            );
            assert!(!target.0.join("books").exists());
            assert_eq!(
                fs::read(target.0.join("state.json")).unwrap(),
                b"conservar biblioteca existente"
            );
            no_stage(&target.0);
        }
    }
    #[test]
    fn saved_view_validation_counts_unicode_like_javascript_and_checks_nested_registers() {
        let mut value = library(vec![book(&"a".repeat(64), "txt")]);
        value["preferences"]["savedViews"] = json!([{
            "id":"view","name":"\u{1f4da}".repeat(50),"filters":{"format":" EPUB ","language":"es-MX","author":"Autora\nInvitada"}
        }]);
        assert!(validate_library(&value).is_ok());
        value["preferences"]["savedViews"][0]["name"] = json!("\u{1f4da}".repeat(51));
        assert!(validate_library(&value).is_err());
        value["preferences"]["savedViews"] = json!([]);
        let key = serde_json::to_string(&["", "preferences"]).unwrap();
        value["registers"][&key] = json!({"time":1,"counter":0,"device":"fixture","value":{
            "savedViews":[{"id":"view","name":"Prueba","filters":{"secretPath":"C:/private"}}]
        }});
        assert!(validate_library(&value).is_err());
        value["registers"][&key]["value"] =
            json!({"view":"covers","readingMode":"page","savedViews":[]});
        assert!(validate_library(&value).is_ok());
        let language_key = serde_json::to_string(&["a".repeat(64), "language".into()]).unwrap();
        value["registers"][&language_key] =
            json!({"time":1,"counter":0,"device":"fixture","value":false});
        assert!(validate_library(&value).is_err());
        value["registers"][&language_key]["value"] = json!("es-MX");
        let locator_key = serde_json::to_string(&["a".repeat(64), "locator".into()]).unwrap();
        value["registers"][&locator_key] =
            json!({"time":1,"counter":0,"device":"fixture","value":{"offset":-1}});
        assert!(validate_library(&value).is_err());
    }
    #[test]
    fn corrupt_second_book_rolls_back_all_staged_files() {
        let source = Root::new();
        let target = Root::new();
        let first = b"Primer libro";
        let second = b"Segundo libro";
        let a = hash(first);
        let b = hash(second);
        let path_a = format!("books/{a}.txt");
        let path_b = format!("books/{b}.txt");
        let m = manifest(
            vec![book(&a, "txt"), book(&b, "txt")],
            vec![(&a, "txt", first), (&b, "txt", second)],
        );
        let archive = source.0.join("bad.zip");
        zip_file(
            &archive,
            &m,
            vec![(&path_a, first), (&path_b, b"Libro alterado")],
        );
        assert!(import_from(&target.0, &archive).is_err());
        assert!(!target.0.join("books").exists());
        no_stage(&target.0);
    }
    #[test]
    fn unknown_entries_traversal_and_invalid_book_ids_abort_before_storage() {
        let source = Root::new();
        let target = Root::new();
        let empty = manifest(vec![], vec![]);
        for name in [
            "drive.vault",
            "../state.json",
            "books/../../state.json",
            "C:/outside.txt",
            "books\\..\\state.json",
        ] {
            let archive = source.0.join("bad.zip");
            zip_file(&archive, &empty, vec![(name, b"private")]);
            assert!(import_from(&target.0, &archive).is_err());
            assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
        }
        let invalid = manifest(vec![book("../../state", "txt")], vec![]);
        let archive = source.0.join("invalid.zip");
        zip_file(&archive, &invalid, vec![]);
        assert!(import_from(&target.0, &archive).is_err());
        assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
    }
    #[test]
    fn duplicate_zip_names_and_json_keys_are_rejected() {
        let source = Root::new();
        let target = Root::new();
        let archive = source.0.join("duplicates.zip");
        zip_file(
            &archive,
            &manifest(vec![], vec![]),
            vec![("metadata1.json", b"1"), ("metadata2.json", b"2")],
        );
        let mut bytes = fs::read(&archive).unwrap();
        let from = b"metadata2.json";
        let to = b"metadata1.json";
        let positions = bytes
            .windows(from.len())
            .enumerate()
            .filter_map(|(i, v)| (v == from).then_some(i))
            .collect::<Vec<_>>();
        for i in positions {
            bytes[i..i + to.len()].copy_from_slice(to);
        }
        fs::write(&archive, bytes).unwrap();
        assert!(import_from(&target.0, &archive)
            .unwrap_err()
            .contains("repetidas"));
        assert!(serde_json::from_str::<StrictValue>("{\"version\":1,\"version\":2}").is_err());
        assert!(
            serde_json::from_str::<StrictValue>("{\"library\":{\"books\":[],\"books\":[]}}")
                .is_err()
        );
        no_stage(&target.0);
    }
    #[test]
    fn existing_corrupt_original_is_preserved_and_failed_export_keeps_previous_zip() {
        let root = Root::new();
        let bytes = b"Contenido original";
        let id = hash(bytes);
        let record = book(&id, "txt");
        fs::create_dir(root.0.join("books")).unwrap();
        let original = book_files::path(&root.0.join("books"), &id, "txt").unwrap();
        fs::write(&original, b"corrupt").unwrap();
        let archive = root.0.join("restore.zip");
        let path = format!("books/{id}.txt");
        zip_file(
            &archive,
            &manifest(vec![record.clone()], vec![(&id, "txt", bytes)]),
            vec![(&path, bytes)],
        );
        assert!(import_from(&root.0, &archive).is_err());
        assert_eq!(fs::read(&original).unwrap(), b"corrupt");
        no_stage(&root.0);
        let previous = root.0.join("previous.zip");
        fs::write(&previous, b"previous backup").unwrap();
        assert!(export_to(&root.0, &previous, library(vec![record])).is_err());
        assert_eq!(fs::read(&previous).unwrap(), b"previous backup");
        assert!(!fs::read_dir(&root.0).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_str()
            .unwrap()
            .ends_with(".tmp")));
    }
    #[test]
    fn date_and_unsupported_versions_are_validated() {
        assert_eq!(date_stamp(0), "1970-01-01");
        assert_eq!(date_stamp(1_704_067_200_000), "2024-01-01");
        assert!(validate_library(&json!({"version":2,"preferences":{},"books":[]})).is_err());
        assert!(validate_library(&library(vec![book(&"a".repeat(64), "exe")])).is_err());
    }
    #[test]
    fn pdf_backup_keeps_original_bytes_reference_and_physical_page_locator() {
        let source = Root::new();
        let target = Root::new();
        let bytes = b"%PDF-1.4 synthetic transfer fixture";
        let (id, _) =
            book_files::receive(&source.0.join("books"), "pdf", &bytes[..], None, || false)
                .unwrap();
        let mut record = book(&id, "pdf");
        record["locator"] = json!({"chapter":"pdf-page-3","fraction":0.25});
        record["progress"] = json!(0.45);
        record["lastReadAt"] = json!(5);
        let mut value = library(vec![record]);
        value["preferences"]["pdfView"] = json!("original");
        value["preferences"]["pdfZoom"] = json!("fit-width");
        value["preferences"]["pdfLayout"] = json!("spread");
        let archive = source.0.join("pdf.zip");
        export_to(&source.0, &archive, value.clone()).unwrap();
        let restored = import_from(&target.0, &archive).unwrap();
        assert_eq!(restored["library"], value);
        assert_eq!(
            fs::read(book_files::path(&target.0.join("books"), &id, "pdf").unwrap()).unwrap(),
            bytes
        );
        assert_eq!(
            import_from(&target.0, &archive).unwrap()["filesImported"],
            0
        );
    }
    #[test]
    fn document_backup_roundtrips_bytes_progress_annotations_and_saved_filters() {
        for format in ["fb2", "docx", "odt", "html", "htm", "md", "markdown", "cbz"] {
            let source = Root::new();
            let target = Root::new();
            let bytes = format!("Original document transfer fixture for {format}").into_bytes();
            let (id, _) =
                book_files::receive(&source.0.join("books"), format, &bytes[..], None, || false)
                    .unwrap();
            let mut record = book(&id, format);
            record["locator"] = json!({"chapter":"section-2","fraction":0.3,"offset":20});
            record["progress"] = json!(0.2);
            record["lastReadAt"] = json!(5);
            record["annotations"] = json!([{"id":"note-1","type":"note","chapter":"section-2","start":3,"end":8,"quote":"texto","note":"Comentario","label":"","color":"yellow","createdAt":3,"updatedAt":3,"deleted":false}]);
            let mut value = library(vec![record]);
            value["preferences"]["readingMode"] = json!("vertical");
            value["preferences"]["savedViews"] =
                json!([{"id":"new-format","name":"Documentos","filters":{"format":format}}]);
            let archive = source.0.join("documents.zip");
            export_to(&source.0, &archive, value.clone()).unwrap();
            let restored = import_from(&target.0, &archive).unwrap();
            assert_eq!(restored["library"], value);
            assert_eq!(
                fs::read(book_files::path(&target.0.join("books"), &id, format).unwrap()).unwrap(),
                bytes
            );
            assert_eq!(
                import_from(&target.0, &archive).unwrap()["filesImported"],
                0
            );
        }
    }
    #[test]
    fn symlink_archive_entry_is_never_followed() {
        let source = Root::new();
        let target = Root::new();
        let archive = source.0.join("symlink.zip");
        let mut writer = ZipWriter::new(fs::File::create(&archive).unwrap());
        writer
            .add_symlink("manifest.json", "../outside", SimpleFileOptions::default())
            .unwrap();
        writer.finish().unwrap();
        assert!(import_from(&target.0, &archive)
            .unwrap_err()
            .contains("enlace"));
        assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
    }
    #[test]
    fn invalid_preferences_and_annotations_abort_before_committing_valid_bytes() {
        let source = Root::new();
        let target = Root::new();
        let bytes = b"Un libro perfectamente integro";
        let id = hash(bytes);
        let path = format!("books/{id}.txt");
        for case in 0..3 {
            let mut m = manifest(vec![book(&id, "txt")], vec![(&id, "txt", bytes)]);
            match case {
                0 => m.library["preferences"]["fontSize"] = json!(999),
                1 => m.library["books"][0]["annotations"] = json!([{"id":"bad"}]),
                _ => {
                    m.library["books"][0]["audioPosition"] =
                        json!({"chapter":"chapter","offset":-1,"voice":"voice","rate":1})
                }
            }
            let archive = source.0.join("invalid.zip");
            zip_file(&archive, &m, vec![(&path, bytes)]);
            assert!(import_from(&target.0, &archive).is_err());
            assert!(!target.0.join("books").exists());
            no_stage(&target.0);
        }
    }

    const LIMITE_PRUEBA: u64 = 512;

    fn zip_raw(path: &Path, entries: Vec<(&str, Vec<u8>)>) {
        let mut writer = ZipWriter::new(fs::File::create(path).unwrap());
        for (nombre, bytes) in entries {
            writer
                .start_file(nombre, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    // Manifiesto JSON válido rellenado con espacios hasta `total` bytes: los
    // espacios tras el prefijo válido cuentan como tamaño real.
    fn manifiesto_relleno(total: usize) -> Vec<u8> {
        let base = br#"{"version":1,"kind":"lector-libre-backup","createdAt":1,"library":{"version":1,"preferences":{"view":"covers","theme":"midnight"},"books":[],"registers":{}},"files":[]}"#;
        assert!(base.len() <= total);
        let mut bytes = base.to_vec();
        bytes.extend(b" ".repeat(total - base.len()));
        bytes
    }

    #[test]
    fn import_rejects_manifest_declared_over_limit_preserves_library() {
        let source = Root::new();
        let target = Root::new();
        fs::write(target.0.join("state.json"), b"biblioteca existente").unwrap();
        let bytes = b"un libro de prueba";
        let id = hash(bytes);
        let path = format!("books/{id}.txt");
        let mut m = manifest(vec![book(&id, "txt")], vec![(&id, "txt", bytes)]);
        m.library["books"][0]["title"] = json!("x".repeat(900));
        let archive = source.0.join("declarado.zip");
        zip_file(&archive, &m, vec![(&path, bytes)]);
        assert!(import_from_limited(&target.0, &archive, LIMITE_PRUEBA)
            .unwrap_err()
            .contains("límite"));
        assert!(!target.0.join("books").exists());
        no_stage(&target.0);
        assert_eq!(
            fs::read(target.0.join("state.json")).unwrap(),
            b"biblioteca existente"
        );
    }

    #[test]
    fn import_rejects_actual_oversized_manifest_before_stage() {
        let source = Root::new();
        let target = Root::new();
        let archive = source.0.join("real.zip");
        zip_raw(
            &archive,
            vec![(
                "manifest.json".into(),
                manifiesto_relleno(LIMITE_PRUEBA as usize + 100),
            )],
        );
        assert!(import_from_limited(&target.0, &archive, LIMITE_PRUEBA)
            .unwrap_err()
            .contains("límite"));
        assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
        no_stage(&target.0);
    }

    #[test]
    fn import_rejects_oversized_trailing_whitespace_after_valid_json_prefix() {
        let source = Root::new();
        let target = Root::new();
        let mut prefix = br#"{}"#.to_vec();
        prefix.extend(b" ".repeat(LIMITE_PRUEBA as usize + 10));
        let archive = source.0.join("espacios.zip");
        zip_raw(&archive, vec![("manifest.json".into(), prefix)]);
        assert!(import_from_limited(&target.0, &archive, LIMITE_PRUEBA)
            .unwrap_err()
            .contains("límite"));
        assert_eq!(fs::read_dir(&target.0).unwrap().count(), 0);
        no_stage(&target.0);
    }

    #[test]
    fn import_accepts_manifest_exactly_at_limit_boundary() {
        let source = Root::new();
        let target = Root::new();
        let archive = source.0.join("limite.zip");
        zip_raw(
            &archive,
            vec![(
                "manifest.json".into(),
                manifiesto_relleno(LIMITE_PRUEBA as usize),
            )],
        );
        // Cabe exactamente en el límite: el rechazo, si lo hay, es de contenido, no de tamaño.
        match import_from_limited(&target.0, &archive, LIMITE_PRUEBA) {
            Ok(_) => {}
            Err(e) => assert!(!e.contains("límite"), "error inesperado: {e}"),
        }
        no_stage(&target.0);
    }

    #[test]
    fn import_rejects_duplicate_json_keys_in_manifest() {
        let source = Root::new();
        let target = Root::new();
        let archive = source.0.join("duplicado.zip");
        zip_raw(
            &archive,
            vec![(
                "manifest.json".into(),
                br#"{"version":1,"version":2,"kind":"lector-libre-backup","createdAt":1,"library":{},"files":[]}"#.to_vec(),
            )],
        );
        assert!(import_from_limited(&target.0, &archive, LIMITE_PRUEBA)
            .unwrap_err()
            .contains("repetida"));
        no_stage(&target.0);
    }

    #[test]
    fn export_rejects_oversized_manifest_and_keeps_previous_destination() {
        let root = Root::new();
        let bytes = b"libro de prueba de exportacion";
        let (id, _) =
            book_files::receive(&root.0.join("books"), "txt", &bytes[..], None, || false).unwrap();
        let mut value = library(vec![book(&id, "txt")]);
        value["books"][0]["title"] = json!("x".repeat(900));
        let previous = root.0.join("previous.zip");
        fs::write(&previous, b"previous backup").unwrap();
        assert!(export_to_limited(&root.0, &previous, value, LIMITE_PRUEBA).is_err());
        assert_eq!(fs::read(&previous).unwrap(), b"previous backup");
        assert!(!fs::read_dir(&root.0)
            .unwrap()
            .any(|e| { e.unwrap().file_name().to_str().unwrap().ends_with(".tmp") }));
    }

    #[test]
    fn export_import_symmetry_respects_injected_limit() {
        let source = Root::new();
        let destination = Root::new();
        let bytes = b"Texto de copia con tildes.";
        let (id, _) =
            book_files::receive(&source.0.join("books"), "txt", &bytes[..], None, || false)
                .unwrap();
        let value = library(vec![book(&id, "txt")]);
        let archive = source.0.join("copia.zip");
        export_to_limited(&source.0, &archive, value.clone(), 4096).unwrap();
        let restored = import_from_limited(&destination.0, &archive, 4096).unwrap();
        assert_eq!(restored["library"], value);
        assert_eq!(restored["filesImported"], 1);
        assert_eq!(restored["remoteBooks"], 0);
        no_stage(&destination.0);
    }
}

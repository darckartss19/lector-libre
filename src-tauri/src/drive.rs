// Native OAuth + private appDataFolder. Tokens never pass through the webview.
#[cfg(target_os = "android")]
use base64::engine::general_purpose::STANDARD;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
struct FolderIndex {
    id: String,
    checked: Instant,
    files: Vec<Value>,
}
#[derive(Default)]
pub struct DriveLock(pub Mutex<()>, pub AtomicBool, Mutex<Option<FolderIndex>>);
const API: &str = "https://www.googleapis.com/drive/v3/files";
const APPDATA: &str = "https://www.googleapis.com/auth/drive.appdata";
const FILE: &str = "https://www.googleapis.com/auth/drive.file";
const READONLY: &str = "https://www.googleapis.com/auth/drive.readonly";
fn has_scope(data: &Value, scope: &str) -> bool {
    data["scopes"]
        .as_str()
        .unwrap_or(APPDATA)
        .split_whitespace()
        .any(|s| s == scope)
}
fn config(data: &Value) -> Value {
    let connected = data["refresh_token"].is_string() || data["android_connected"] == true;
    json!({"configured":data["client_id"].is_string() || cfg!(target_os="android"),"connected":connected,
        "booksEnabled":connected && has_scope(data, FILE),"canImport":connected && has_scope(data, READONLY),
        "folderUrl":data["library_folder"].as_str().map(|id|format!("https://drive.google.com/drive/folders/{id}"))})
}
fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())
}
fn transfer_http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(None)
        .build()
        .map_err(|e| e.to_string())
}
fn response(r: reqwest::blocking::Response) -> Result<Value, String> {
    let status = r.status();
    if !status.is_success() {
        return Err(format!(
            "Google devolvió {}. Comprueba la conexión y el permiso de Drive.",
            status.as_u16()
        ));
    }
    r.json()
        .map_err(|_| "Google devolvió una respuesta no válida.".into())
}
#[cfg(windows)]
fn crypt(_app: &tauri::AppHandle, bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    windows_crypt(bytes, decrypt)
}
#[cfg(windows)]
fn windows_crypt(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
        .map_err(|_| "No se pudo abrir el almacén seguro de Windows.".to_string())?;
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            output.pbData as *mut _,
        )));
        Ok(result)
    }
}
#[cfg(not(any(windows, target_os = "android")))]
fn crypt(_: &tauri::AppHandle, _: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("El almacén seguro de esta versión requiere Windows.".into())
}
#[cfg(target_os = "android")]
fn crypt(app: &tauri::AppHandle, bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    let result = tauri_plugin_reader_mobile::blocking_command(
        app,
        "secureBytes",
        json!({"data":STANDARD.encode(bytes),"decrypt":decrypt}),
    )?;
    STANDARD
        .decode(
            result["data"]
                .as_str()
                .ok_or("Almacén de Android no válido.")?,
        )
        .map_err(|_| "No se pudo abrir el almacén seguro de Android.".into())
}
fn vault(app: &tauri::AppHandle) -> Result<Value, String> {
    let path = crate::directory(app)?.join("drive.vault");
    if !path.exists() && !path.with_extension("vault.bak").exists() {
        return Ok(json!({}));
    }
    for candidate in [&path, &path.with_extension("vault.bak")] {
        if let Ok(bytes) = fs::read(candidate) {
            if let Ok(plain) = crypt(app, &bytes, true) {
                if let Ok(value) = serde_json::from_slice(&plain) {
                    return Ok(value);
                }
            }
        }
    }
    Err("No se pudo recuperar el almacén seguro de Drive.".into())
}
fn save_vault(app: &tauri::AppHandle, value: &Value) -> Result<(), String> {
    let bytes = crypt(
        app,
        &serde_json::to_vec(value).map_err(|e| e.to_string())?,
        false,
    )?;
    let path = crate::directory(app)?.join("drive.vault");
    let temp = path.with_extension("vault.tmp");
    let mut output = fs::File::create(&temp).map_err(|e| e.to_string())?;
    output
        .write_all(&bytes)
        .and_then(|_| output.sync_all())
        .map_err(|e| e.to_string())?;
    drop(output);
    if path.exists() {
        fs::copy(&path, path.with_extension("vault.bak")).map_err(|e| e.to_string())?;
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    fs::rename(temp, path).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn drive_config(app: tauri::AppHandle, import: bool) -> Result<Value, String> {
    if !crate::release_policy::drive_enabled() {
        return Ok(
            json!({"configured":false,"connected":false,"booksEnabled":false,"canImport":false,"available":false}),
        );
    }
    #[cfg(target_os = "android")]
    {
        let _ = import;
        return tauri::async_runtime::spawn_blocking(move || vault(&app).map(|data| config(&data)))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<DriveLock>();let _guard=state.0.try_lock().map_err(|_|"Drive está trabajando.".to_string())?;
        let mut data=vault(&app)?;
        if import {
            if data["refresh_token"].is_string() {return Err("Desconecta la cuenta antes de cambiar la configuración de Google.".into());}
            let Some(file)=app.dialog().file().add_filter("Cliente OAuth de Google",&["json"]).blocking_pick_file() else {return Ok(config(&data));};
            let bytes=fs::read(file.into_path().map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            if bytes.len()>32_000 {return Err("Archivo OAuth demasiado grande.".into());}
            let config:Value=serde_json::from_slice(&bytes).map_err(|_|"JSON de OAuth no válido.".to_string())?;
            let client=&config["installed"];
            let id=client["client_id"].as_str().ok_or("Se necesita un cliente OAuth de escritorio.")?;
            if !id.ends_with(".apps.googleusercontent.com") {return Err("Cliente de Google no válido.".into());}
            data=json!({"client_id":id,"client_secret":client["client_secret"].as_str().ok_or("Falta la configuración de OAuth")?});
            save_vault(&app,&data)?;
        }
        Ok(config(&data))
    }).await.map_err(|e|e.to_string())?
}
fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Conexión de escritorio disponible primero en Windows.".into())
    }
}
#[tauri::command]
pub async fn drive_connect(app: tauri::AppHandle, mode: Option<String>) -> Result<Value, String> {
    crate::release_policy::require_drive()?;
    #[cfg(target_os = "android")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<DriveLock>();
            let _guard = state.0.try_lock().map_err(|_| "Drive está trabajando.")?;
            let mut data = vault(&app)?;
            let mode = mode.as_deref().unwrap_or("progress");
            if !["progress", "library", "import"].contains(&mode) {
                return Err("Tipo de conexión no válido.".into());
            }
            let mut scopes = vec![APPDATA];
            if mode != "progress" || has_scope(&data, FILE) {
                scopes.push(FILE);
            }
            if mode == "import" || has_scope(&data, READONLY) {
                scopes.push(READONLY);
            }
            let granted = tauri_plugin_reader_mobile::blocking_command(
                &app,
                "googleAuthorize",
                json!({"scopes":scopes,"interactive":true}),
            )?;
            let actual = granted["scopes"]
                .as_array()
                .ok_or("Google no devolvió los permisos de Drive.")?
                .iter()
                .filter_map(Value::as_str)
                .filter(|s| [APPDATA, FILE, READONLY].contains(s))
                .collect::<Vec<_>>()
                .join(" ");
            data["android_connected"] = json!(true);
            data["scopes"] = json!(actual);
            save_vault(&app, &data)?;
            *state.2.lock().map_err(|_| "Índice de Drive ocupado.")? = None;
            Ok(config(&data))
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<DriveLock>();let _guard=state.0.try_lock().map_err(|_|"Ya hay una operación de Drive en curso.".to_string())?;
        let mut data=vault(&app)?;
        let client=data["client_id"].as_str().ok_or("Importa primero el JSON del cliente OAuth de escritorio.")?.to_owned();
        let secret=data["client_secret"].as_str().unwrap_or("").to_owned();
        let mode = mode.as_deref().unwrap_or("progress");
        if !["progress", "library", "import"].contains(&mode) { return Err("Tipo de conexión no válido.".into()); }
        let mut scopes = vec![APPDATA];
        if mode != "progress" || has_scope(&data, FILE) { scopes.push(FILE); }
        if mode == "import" || has_scope(&data, READONLY) { scopes.push(READONLY); }
        let requested = scopes.join(" ");
        let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;
        listener.set_nonblocking(true).map_err(|e|e.to_string())?;
        let redirect=format!("http://127.0.0.1:{}/oauth/callback",listener.local_addr().map_err(|e|e.to_string())?.port());
        let verifier=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
        let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let nonce=uuid::Uuid::new_v4().to_string();
        let mut auth=url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        auth.query_pairs_mut().extend_pairs([("client_id",client.as_str()),("redirect_uri",&redirect),("response_type","code"),("scope",&requested),("code_challenge",&challenge),("code_challenge_method","S256"),("state",&nonce),("access_type","offline"),("prompt","consent")]);
        open_browser(auth.as_str())?;
        let started=Instant::now();let mut code=None;
        while started.elapsed()<Duration::from_secs(180) {
            match listener.accept() {
                Ok((mut stream,_))=>{
                    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
                    let mut bytes=[0u8;8192];let size=stream.read(&mut bytes).unwrap_or(0);
                    let request=String::from_utf8_lossy(&bytes[..size]);
                    let target=request.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("");
                    let parsed=url::Url::parse(&format!("http://127.0.0.1{target}"));
                    let mut valid=false;
                    if let Ok(url)=parsed {let params:std::collections::HashMap<_,_>=url.query_pairs().into_owned().collect();
                        if url.path()=="/oauth/callback" && params.get("state")==Some(&nonce) {
                            if params.contains_key("error") {let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 17\r\nConnection: close\r\n\r\nConexion omitida.");return Err("Se canceló el permiso de Google.".into());}
                            code=params.get("code").cloned();valid=code.is_some();
                        }
                    }
                    let body=if valid {"Vuelve a Lector libre. Puedes cerrar esta ventana."}else{"Solicitud no valida."};
                    let _=write!(stream,"HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",if valid{"200 OK"}else{"400 Bad Request"},body.len(),body);
                    if valid {break;}
                }, Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(100)),Err(e)=>return Err(e.to_string())
            }
        }
        let code=code.ok_or("No se completó la conexión en tres minutos. Puedes intentarlo de nuevo.")?;
        let token=response(http()?.post("https://oauth2.googleapis.com/token").form(&[("client_id",client.as_str()),("client_secret",secret.as_str()),("code",&code),("code_verifier",&verifier),("redirect_uri",&redirect),("grant_type","authorization_code")]).send().map_err(|_|"No se pudo conectar con Google.".to_string())?)?;
        data["refresh_token"]=json!(token["refresh_token"].as_str().ok_or("Google no devolvió el permiso para sincronizar. Vuelve a conectar.")?);
        data["scopes"] = json!(token["scope"].as_str().unwrap_or(&requested));
        save_vault(&app,&data)?;
        *state.2.lock().map_err(|_|"Índice de Drive ocupado.")? = None;
        Ok(config(&data))
    }).await.map_err(|e|e.to_string())?
}
fn access(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let data = vault(app)?;
        if data["android_connected"] != true {
            return Err("Conecta Google primero.".into());
        }
        let scopes = data["scopes"]
            .as_str()
            .unwrap_or(APPDATA)
            .split_whitespace()
            .collect::<Vec<_>>();
        let result = tauri_plugin_reader_mobile::blocking_command(
            app,
            "googleAuthorize",
            json!({"scopes":scopes,"interactive":false}),
        )?;
        return result["accessToken"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or("Google no devolvió un permiso válido.".into());
    }
    #[cfg(not(target_os = "android"))]
    {
        let data = vault(app)?;
        let token = response(
            http()?
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", data["client_id"].as_str().unwrap_or("")),
                    (
                        "client_secret",
                        data["client_secret"].as_str().unwrap_or(""),
                    ),
                    (
                        "refresh_token",
                        data["refresh_token"]
                            .as_str()
                            .ok_or("Conecta Drive primero.")?,
                    ),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .map_err(|_| "No se pudo renovar la conexión con Google.".to_string())?,
        )?;
        Ok(token["access_token"]
            .as_str()
            .ok_or("Vuelve a conectar tu cuenta de Google.")?
            .into())
    }
}
#[tauri::command]
pub async fn drive_sync(app: tauri::AppHandle, snapshot: Value) -> Result<Vec<Value>, String> {
    crate::release_policy::require_drive()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<DriveLock>();let _guard=state.0.try_lock().map_err(|_|"Drive está trabajando.".to_string())?;
        let device=snapshot["deviceId"].as_str().ok_or("Falta el identificador del dispositivo")?;
        if uuid::Uuid::parse_str(device).is_err() || snapshot["version"]!=1 {return Err("Copia no válida.".into());}
        let name=format!("lector-libre-{device}.json");
        state.1.store(false,Ordering::Relaxed);
        let token=access(&app)?;
        let client=reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(30)).timeout(Duration::from_secs(180)).build().map_err(|e|e.to_string())?;
        let files=collect_pages(|page| {
            let mut params=vec![("spaces","appDataFolder"),("q","trashed=false"),("pageSize","100"),("fields","nextPageToken,files(id,name,size)")];
            if !page.is_empty(){params.push(("pageToken",page));}
            response(client.get(API).bearer_auth(&token).query(&params).send().map_err(|_|"No se pudo leer Drive.".to_string())?)
        },||check_cancel(&app))?;
        let body=serde_json::to_vec(&snapshot).map_err(|e|e.to_string())?;
        if let Some(file)=files.iter().find(|f|f["name"]==name) {
            let id=file["id"].as_str().ok_or("Archivo de Drive no válido")?;
            response(client.patch(format!("https://www.googleapis.com/upload/drive/v3/files/{id}")).bearer_auth(&token).query(&[("uploadType","media")]).header("Content-Type","application/json").body(body).send().map_err(|_|"No se pudo guardar en Drive.".to_string())?)?;
        } else {
            let boundary=uuid::Uuid::new_v4().simple().to_string();
            let metadata=json!({"name":name,"parents":["appDataFolder"]}).to_string();
            let payload=format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{}\r\n--{boundary}--\r\n",String::from_utf8(body).map_err(|e|e.to_string())?);
            response(client.post("https://www.googleapis.com/upload/drive/v3/files").bearer_auth(&token).query(&[("uploadType","multipart")]).header("Content-Type",format!("multipart/related; boundary={boundary}")).body(payload).send().map_err(|_|"No se pudo crear la copia en Drive.".to_string())?)?;
        }
        let mut snapshots=vec![];
        for file in files.iter().filter(|f|f["name"].as_str().map(|n|n.starts_with("lector-libre-")&&n.ends_with(".json")&&n!=name).unwrap_or(false)) {
            let id=file["id"].as_str().ok_or("Archivo de Drive no válido")?;
            snapshots.push(response(client.get(format!("{API}/{id}")).bearer_auth(&token).query(&[("alt","media")]).send().map_err(|_|"No se pudo leer una copia de Drive.".to_string())?)?);
        }
        Ok(snapshots)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn drive_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    crate::release_policy::require_drive()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DriveLock>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Drive está trabajando.".to_string())?;
        let mut data = vault(&app)?;
        #[cfg(target_os = "android")]
        if data["android_connected"] == true {
            if let Ok(token) = access(&app) {
                let result = http()?
                    .post("https://oauth2.googleapis.com/revoke")
                    .form(&[("token", token)])
                    .send()
                    .map_err(|_| "No se pudo revocar el permiso. Inténtalo con conexión.")?;
                if !result.status().is_success() {
                    return Err("Google no confirmó la revocación.".into());
                }
            }
            data["android_connected"] = json!(false);
        }
        if let Some(token) = data["refresh_token"].as_str() {
            let result = http()?
                .post("https://oauth2.googleapis.com/revoke")
                .form(&[("token", token)])
                .send()
                .map_err(|_| {
                    "No se pudo revocar el permiso. Inténtalo con conexión.".to_string()
                })?;
            if !result.status().is_success() {
                return Err("Google no confirmó la revocación.".into());
            }
        }
        data.as_object_mut()
            .ok_or("Almacén no válido")?
            .remove("refresh_token");
        *state.2.lock().map_err(|_| "Índice de Drive ocupado.")? = None;
        save_vault(&app, &data)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn safe_drive_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn folder_id(input: &str) -> Result<String, String> {
    let input = input.trim();
    if safe_drive_id(input) {
        return Ok(input.to_owned());
    }
    let parsed = url::Url::parse(input)
        .map_err(|_| "Pega el enlace de una carpeta de Google Drive.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("drive.google.com") {
        return Err("Se necesita un enlace de carpeta de Google Drive.".into());
    }
    let parts: Vec<_> = parsed.path_segments().into_iter().flatten().collect();
    let id = parts
        .windows(2)
        .find(|p| p[0] == "folders")
        .map(|p| p[1])
        .filter(|id| safe_drive_id(id))
        .ok_or("El enlace no contiene una carpeta de Drive.")?;
    Ok(id.to_owned())
}
fn progress(app: &tauri::AppHandle, message: String) {
    let _ = app.emit("drive-transfer", json!({"message":message}));
}
fn cancelled(app: &tauri::AppHandle) -> bool {
    app.state::<DriveLock>().1.load(Ordering::Relaxed)
}
fn check_cancel(app: &tauri::AppHandle) -> Result<(), String> {
    if cancelled(app) {
        Err("Operación detenida. Se conservan los libros ya guardados.".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub fn drive_cancel(app: tauri::AppHandle) {
    if !crate::release_policy::drive_enabled() {
        return;
    }
    app.state::<DriveLock>().1.store(true, Ordering::Relaxed);
}
fn collect_pages(
    mut fetch: impl FnMut(&str) -> Result<Value, String>,
    mut stop: impl FnMut() -> Result<(), String>,
) -> Result<Vec<Value>, String> {
    let mut files = vec![];
    let mut page = String::new();
    let mut seen = std::collections::HashSet::new();
    loop {
        stop()?;
        if !seen.insert(page.clone()) {
            return Err("Drive repitió una página. Reintenta la revisión de la carpeta.".into());
        }
        let list = fetch(&page)?;
        files.extend(list["files"].as_array().cloned().unwrap_or_default());
        page = list["nextPageToken"].as_str().unwrap_or("").to_owned();
        if page.is_empty() {
            break;
        }
    }
    Ok(files)
}
fn list_files(
    app: &tauri::AppHandle,
    client: &reqwest::blocking::Client,
    token: &str,
    query: &str,
) -> Result<Vec<Value>, String> {
    collect_pages(
        |page| {
            let mut params = vec![
                ("q", query),
                ("spaces", "drive"),
                ("pageSize", "100"),
                (
                    "fields",
                    "nextPageToken,files(id,name,mimeType,size,parents,sha256Checksum,appProperties)",
                ),
            ];
            if !page.is_empty() {
                params.push(("pageToken", &page));
            }
            response(
                client
                    .get(API)
                    .bearer_auth(token)
                    .query(&params)
                    .send()
                    .map_err(|_| "No se pudo leer la carpeta de Drive.".to_string())?,
            )
        },
        || check_cancel(app),
    )
}
fn managed_folder(
    app: &tauri::AppHandle,
    client: &reqwest::blocking::Client,
    token: &str,
) -> Result<Vec<String>, String> {
    let mut data = vault(app)?;
    let mut folders = list_files(app,client, token, "trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='lectorLibre' and value='biblioteca-v1' }")?;
    // The marker is app-private and works on other devices using the same OAuth client.
    if folders.is_empty() {
        folders.push(response(client.post(API).bearer_auth(token).query(&[("fields","id")]).json(&json!({"name":"Lector libre","mimeType":"application/vnd.google-apps.folder","appProperties":{"lectorLibre":"biblioteca-v1"}})).send().map_err(|_| "No se pudo crear la carpeta del lector en Drive.".to_string())?)?);
    }
    let mut ids: Vec<String> = folders
        .iter()
        .map(|folder| {
            folder["id"]
                .as_str()
                .filter(|id| safe_drive_id(id))
                .map(str::to_owned)
                .ok_or("Carpeta de Drive no válida.".to_owned())
        })
        .collect::<Result<_, _>>()?;
    ids.sort();
    data["library_folder"] = json!(ids[0]);
    save_vault(app, &data)?;
    Ok(ids)
}
fn folder_info(client: &reqwest::blocking::Client, token: &str, id: &str) -> Result<Value, String> {
    if !safe_drive_id(id) {
        return Err("Carpeta de Drive no válida.".into());
    }
    let info = response(
        client
            .get(format!("{API}/{id}"))
            .bearer_auth(token)
            .query(&[(
                "fields",
                "id,name,mimeType,trashed,capabilities(canAddChildren)",
            )])
            .send()
            .map_err(|_| "No se pudo comprobar la carpeta de biblioteca.".to_string())?,
    )?;
    if info["mimeType"] != "application/vnd.google-apps.folder" || info["trashed"] == true {
        return Err("La carpeta de biblioteca no está disponible. Elige otra carpeta; no se creará una automáticamente.".into());
    }
    Ok(info)
}
#[tauri::command]
pub async fn drive_use_folder(app: tauri::AppHandle, folder: String) -> Result<Value, String> {
    crate::release_policy::require_drive()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DriveLock>();
        let _guard = state.0.try_lock().map_err(|_| "Drive está trabajando.".to_string())?;
        let mut data = vault(&app)?;
        if !has_scope(&data, READONLY) { return Err("Autoriza primero la lectura de carpetas de Drive.".into()); }
        let id = folder_id(&folder)?;
        let info = folder_info(&http()?, &access(&app)?, &id)?;
        data["library_folder"] = json!(id);
        save_vault(&app, &data)?;
        Ok(json!({"id":id,"name":info["name"],"canUpload":info["capabilities"]["canAddChildren"] == true}))
    }).await.map_err(|e| e.to_string())?
}
fn checksum(file: &Value) -> Option<String> {
    // Prefer Drive's digest over an app property, which can be stale after editing a file.
    let digest = file["sha256Checksum"]
        .as_str()
        .or_else(|| file["sha256"].as_str())
        .or_else(|| file["appProperties"]["sha256"].as_str())?;
    let digest = digest.to_ascii_lowercase();
    crate::book_files::valid_id(&digest).then_some(digest)
}
fn binding(book_id: &str, file: &Value, fallback_folder: &str) -> Value {
    let parent = file["folderId"]
        .as_str()
        .or_else(|| file["parents"][0].as_str())
        .unwrap_or(fallback_folder);
    json!({"id":book_id,"driveSource":{"fileId":file["id"],"folderId":parent,"sha256":book_id}})
}
fn matching_file(files: &[Value], book: &Value) -> Option<Value> {
    let id = book["id"].as_str()?;
    let format = book["format"].as_str()?;
    // Prefer the original imported file if byte-identical copies already exist.
    files
        .iter()
        .filter(|file| {
            let remote_format =
                source_format(file).or_else(|| file["format"].as_str().map(str::to_owned));
            checksum(file).as_deref() == Some(id) && remote_format.as_deref() == Some(format)
        })
        .min_by_key(|file| file["id"] != book["driveSource"]["fileId"])
        .cloned()
}
fn library_files(
    app: &tauri::AppHandle,
    client: &reqwest::blocking::Client,
    token: &str,
    id: &str,
) -> Result<Vec<Value>, String> {
    let state = app.state::<DriveLock>();
    if let Some(cache) = state
        .2
        .lock()
        .map_err(|_| "Índice de Drive ocupado.")?
        .as_ref()
    {
        if cache.id == id && cache.checked.elapsed() < Duration::from_secs(600) {
            return Ok(cache.files.clone());
        }
    }
    let mut count = 0;
    let (files, _) = scan_tree(id.to_owned(), true, |folder| {
        count += 1;
        progress(app, format!("Comprobando biblioteca · carpeta {count}…"));
        list_files(
            app,
            client,
            token,
            &format!("trashed=false and '{folder}' in parents"),
        )
    })?;
    *state.2.lock().map_err(|_| "Índice de Drive ocupado.")? = Some(FolderIndex {
        id: id.to_owned(),
        checked: Instant::now(),
        files: files.clone(),
    });
    Ok(files)
}
fn upload_book(
    app: &tauri::AppHandle,
    client: &reqwest::blocking::Client,
    token: &str,
    folder: &str,
    book: &Value,
    path: &std::path::Path,
) -> Result<Value, String> {
    let id = book["id"].as_str().ok_or("Libro no válido")?;
    let format = book["format"].as_str().ok_or("Libro no válido")?;
    if crate::book_files::hash_file(path)? != id {
        return Err(
            "El archivo local no coincide con el libro registrado; se conserva sin subir.".into(),
        );
    }
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    let mime = book_mime(format);
    let title: String = book["title"]
        .as_str()
        .unwrap_or("Libro")
        .chars()
        .take(150)
        .collect();
    let metadata = json!({"name":format!("{title}.{format}"),"parents":[folder],"appProperties":{"lectorLibre":"libro-v1","sha256":id,"format":format}});
    let start = client
        .post("https://www.googleapis.com/upload/drive/v3/files")
        .bearer_auth(token)
        .query(&[
            ("uploadType", "resumable"),
            ("fields", "id,name,size,appProperties"),
        ])
        .header("X-Upload-Content-Type", mime)
        .header("X-Upload-Content-Length", size)
        .json(&metadata)
        .send()
        .map_err(|_| "No se pudo preparar la subida del libro.".to_string())?;
    if !start.status().is_success() {
        return Err(format!(
            "Google no aceptó la subida ({}).",
            start.status().as_u16()
        ));
    }
    let location = start
        .headers()
        .get("Location")
        .and_then(|v| v.to_str().ok())
        .ok_or("Google no devolvió la dirección de subida.")?;
    let url = url::Url::parse(location).map_err(|_| "Dirección de subida no válida.")?;
    if url.scheme() != "https" || url.host_str() != Some("www.googleapis.com") {
        return Err("Dirección de subida no válida.".into());
    }
    upload_chunks(
        &transfer_http()?,
        token,
        url,
        fs::File::open(path).map_err(|e| e.to_string())?,
        size,
        mime,
        || check_cancel(app),
        |position| {
            progress(
                app,
                format!(
                    "Subiendo {title} · {:.1} %",
                    if size == 0 {
                        100.0
                    } else {
                        position as f64 * 100.0 / size as f64
                    }
                ),
            )
        },
    )
}
fn upload_position(header: Option<&str>, size: u64) -> Result<u64, String> {
    match header {
        None => Ok(0),
        Some(header) => header
            .strip_prefix("bytes=0-")
            .and_then(|n| n.parse::<u64>().ok())
            .and_then(|n| n.checked_add(1))
            .filter(|n| *n <= size)
            .ok_or("Google devolvió una posición de subida no válida.".into()),
    }
}
fn upload_chunks(
    client: &reqwest::blocking::Client,
    token: &str,
    url: url::Url,
    mut file: fs::File,
    size: u64,
    mime: &str,
    mut stop: impl FnMut() -> Result<(), String>,
    mut update: impl FnMut(u64),
) -> Result<Value, String> {
    // A block is a multiple of Google's 256 KiB requirement; this is not a file-size limit.
    const BLOCK: usize = 8 * 1024 * 1024;
    let mut position = 0;
    let mut retries = 0;
    loop {
        stop()?;
        file.seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let count = (size - position).min(BLOCK as u64) as usize;
        let mut body = vec![0u8; count];
        file.read_exact(&mut body).map_err(|e| e.to_string())?;
        let range = if count == 0 {
            format!("bytes */{size}")
        } else {
            format!("bytes {position}-{}/{size}", position + count as u64 - 1)
        };
        let sent = client
            .put(url.clone())
            .bearer_auth(token)
            .header("Content-Type", mime)
            .header("Content-Length", count)
            .header("Content-Range", range)
            .body(body)
            .send();
        let result = match sent {
            Ok(result) if !result.status().is_server_error() => result,
            _ => {
                retries += 1;
                if retries > 3 {
                    return Err(
                        "Se interrumpió la subida. Puedes reintentar la sincronización.".into(),
                    );
                }
                stop()?;
                client
                    .put(url.clone())
                    .bearer_auth(token)
                    .header("Content-Length", 0)
                    .header("Content-Range", format!("bytes */{size}"))
                    .send()
                    .map_err(|_| "No se pudo consultar la subida interrumpida.".to_string())?
            }
        };
        if result.status().is_success() {
            update(size);
            return response(result);
        }
        if result.status().as_u16() != 308 {
            return response(result);
        }
        let next = upload_position(
            result.headers().get("Range").and_then(|v| v.to_str().ok()),
            size,
        )?;
        if next == position {
            retries += 1;
        } else {
            retries = 0;
        }
        if retries > 3 {
            return Err("Google no confirmó nuevos bloques. Reintenta la sincronización.".into());
        }
        position = next;
        update(position);
    }
}
fn download_book(
    app: &tauri::AppHandle,
    _client: &reqwest::blocking::Client,
    token: &str,
    file_id: &str,
    format: &str,
    expected: Option<&str>,
) -> Result<(String, u64), String> {
    if !safe_drive_id(file_id) {
        return Err("Archivo de Drive no válido.".into());
    }
    let result = transfer_http()?
        .get(format!("{API}/{file_id}"))
        .bearer_auth(token)
        .query(&[("alt", "media")])
        .send()
        .map_err(|_| "No se pudo descargar el libro.".to_string())?;
    if !result.status().is_success() {
        return Err(format!(
            "No se pudo descargar de Drive ({}).",
            result.status().as_u16()
        ));
    }
    crate::book_files::receive(
        &crate::directory(app)?.join("books"),
        format,
        result,
        expected,
        || cancelled(app),
    )
}
#[tauri::command]
pub async fn drive_books_sync(
    app: tauri::AppHandle,
    books: Vec<Value>,
    download: bool,
    folder: Option<Value>,
) -> Result<Value, String> {
    crate::release_policy::require_drive()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DriveLock>(); let _guard = state.0.try_lock().map_err(|_|"Drive está trabajando.".to_string())?;
        state.1.store(false,Ordering::Relaxed);
        if !has_scope(&vault(&app)?, FILE) { return Err("Activa primero la biblioteca en Drive para sincronizar archivos.".into()); }
        if books.is_empty() {
            return Ok(json!({"uploaded":0,"downloaded":0,"reused":0,"local":[],"cloud":[],"bindings":[],"errors":[],"folderUrl":config(&vault(&app)?)["folderUrl"]}));
        }
        let token = access(&app)?; let client = http()?;
        let selected = folder.as_ref().and_then(|f| f["id"].as_str());
        if folder.is_some() && selected.is_none() { return Err("Carpeta de biblioteca no válida.".into()); }
        let (folder, mut files, can_upload) = if let Some(id) = selected {
            let info = folder_info(&client,&token,id)?;
            let mut data = vault(&app)?;
            data["library_folder"] = json!(id); save_vault(&app,&data)?;
            (id.to_owned(), library_files(&app,&client,&token,id)?, info["capabilities"]["canAddChildren"] == true)
        } else {
            let folders = managed_folder(&app,&client,&token)?;
            let mut files = vec![];
            // Compatibility with libraries that never imported an existing folder.
            for candidate in &folders { files.extend(list_files(&app,&client,&token,&format!("trashed=false and '{candidate}' in parents and appProperties has {{ key='lectorLibre' and value='libro-v1' }}"))?); }
            (folders[0].clone(), files, true)
        };
        let root = crate::directory(&app)?.join("books");
        let mut uploaded = 0; let mut downloaded = 0; let mut reused = 0;
        let mut errors = vec![]; let mut local = vec![]; let mut cloud = vec![]; let mut bindings = vec![];
        for (index,book) in books.iter().enumerate() {
            check_cancel(&app)?;
            let title = book["title"].as_str().unwrap_or("Libro");
            progress(&app,format!("Libro {} de {} · {title}",index+1,books.len()));
            let result = (|| -> Result<(),String> {
                let id = book["id"].as_str().ok_or("Libro no válido")?; let format = book["format"].as_str().ok_or("Formato no válido")?;
                let path = crate::book_files::path(&root,id,format)?;
                let mut remote = matching_file(&files, book);
                if remote.is_none() {
                    if let Some(source) = book["driveSource"]["fileId"].as_str() {
                        if !safe_drive_id(source) { return Err("Referencia de Drive no válida.".into()); }
                        let original = response(client.get(format!("{API}/{source}")).bearer_auth(&token)
                            .query(&[("fields","id,name,mimeType,parents,trashed,sha256Checksum,appProperties")])
                            .send().map_err(|_|"No se pudo comprobar el original; no se subirá una copia.".to_string())?)?;
                        if original["trashed"] == true || matching_file(&[original.clone()],book).is_none() {
                            return Err("El original cambió o ya no está disponible. Se conserva el libro local sin duplicarlo; revisa su carpeta.".into());
                        }
                        remote = Some(original);
                    }
                }
                if remote.is_some() { reused += 1; }
                if path.exists() {
                    local.push(id.to_owned());
                    if remote.is_none() {
                        if !can_upload { return Err("La carpeta de biblioteca permite lectura, pero no añadir libros. No se creará otra carpeta.".into()); }
                        progress(&app,format!("Subiendo {title}…")); let new = upload_book(&app,&client,&token,&folder,book,&path)?;
                        remote=Some(new.clone()); files.push(new.clone()); uploaded+=1;
                        if let Some(cache) = state.2.lock().map_err(|_|"Índice de Drive ocupado.")?.as_mut() {
                            if cache.id == folder { cache.files.push(new); }
                        }
                    }
                } else if download {
                    if let Some(file) = &remote { progress(&app,format!("Descargando {title}…")); download_book(&app,&client,&token,file["id"].as_str().ok_or("Copia no válida")?,format,Some(id))?; downloaded+=1; local.push(id.to_owned()); }
                    else { return Err("El libro aún no fue subido desde el equipo original.".into()); }
                }
                if let Some(file) = remote { cloud.push(id.to_owned()); bindings.push(binding(id,&file,&folder)); }
                Ok(())
            })();
            if let Err(error) = result { errors.push(json!({"title":title,"message":error})); }
        }
        // A completed upload may have lost its final response. Refresh before retrying
        // instead of creating another copy from an outdated index.
        if !errors.is_empty() { *state.2.lock().map_err(|_|"Índice de Drive ocupado.")? = None; }
        Ok(json!({"uploaded":uploaded,"downloaded":downloaded,"reused":reused,"local":local,"cloud":cloud,"bindings":bindings,"errors":errors,"folderUrl":format!("https://drive.google.com/drive/folders/{folder}")}))
    }).await.map_err(|e|e.to_string())?
}
fn book_mime(format: &str) -> &'static str {
    crate::book_files::mime_type(format)
}
fn source_format(file: &Value) -> Option<String> {
    let name = file["name"].as_str()?;
    let format = name.rsplit('.').next()?.to_lowercase();
    if crate::book_files::valid_format(&format)
        && !file["mimeType"]
            .as_str()
            .unwrap_or("")
            .starts_with("application/vnd.google-apps.")
    {
        Some(format)
    } else {
        None
    }
}
fn scan_tree(
    root: String,
    recursive: bool,
    mut load: impl FnMut(&str) -> Result<Vec<Value>, String>,
) -> Result<(Vec<Value>, usize), String> {
    let mut pending = vec![root];
    let mut visited = std::collections::HashSet::new();
    let mut book_ids = std::collections::HashSet::new();
    let mut books = vec![];
    let mut skipped = 0;
    while let Some(folder) = pending.pop() {
        if !visited.insert(folder.clone()) {
            continue;
        }
        for file in load(&folder)? {
            if file["mimeType"] == "application/vnd.google-apps.folder" {
                if recursive {
                    if let Some(id) = file["id"].as_str().filter(|id| safe_drive_id(id)) {
                        pending.push(id.to_owned());
                    }
                }
            } else if let Some(format) = source_format(&file) {
                if let Some(id) = file["id"].as_str().filter(|id| safe_drive_id(id)) {
                    if book_ids.insert(id.to_owned()) {
                        let size = file["size"]
                            .as_str()
                            .and_then(|s| s.parse::<u64>().ok())
                            .unwrap_or(0);
                        books.push(json!({"id":id,"name":file["name"],"format":format,"size":size,"folderId":folder,"sha256":checksum(&file)}));
                    }
                }
            } else {
                skipped += 1;
            }
        }
    }
    books.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });
    Ok((books, skipped))
}
#[tauri::command]
pub async fn drive_list_folder(
    app: tauri::AppHandle,
    folder: String,
    recursive: bool,
) -> Result<Value, String> {
    crate::release_policy::require_drive()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DriveLock>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Drive está trabajando.".to_string())?;
        state.1.store(false, Ordering::Relaxed);
        if !has_scope(&vault(&app)?, READONLY) {
            return Err("Autoriza primero la lectura de carpetas de Drive.".into());
        }
        let id = folder_id(&folder)?;
        let token = access(&app)?;
        let client = http()?;
        let info = response(
            client
                .get(format!("{API}/{id}"))
                .bearer_auth(&token)
                .query(&[("fields", "id,name,mimeType")])
                .send()
                .map_err(|_| "No se pudo leer la carpeta.".to_string())?,
        )?;
        if info["mimeType"] != "application/vnd.google-apps.folder" {
            return Err("El enlace no corresponde a una carpeta.".into());
        }
        let mut count = 0;
        let (books, skipped) = scan_tree(id.clone(), recursive, |folder| {
            check_cancel(&app)?;
            count += 1;
            progress(&app, format!("Revisando carpeta {count}…"));
            list_files(
                &app,
                &client,
                &token,
                &format!("trashed=false and '{folder}' in parents"),
            )
        })?;
        if recursive {
            *state.2.lock().map_err(|_| "Índice de Drive ocupado.")? = Some(FolderIndex {
                id: id.clone(),
                checked: Instant::now(),
                files: books.clone(),
            });
        }
        Ok(json!({"id":id,"name":info["name"],"files":books,"skipped":skipped}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drive_import_file(app: tauri::AppHandle, file_id: String) -> Result<Value, String> {
    crate::release_policy::require_drive()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DriveLock>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Drive está trabajando.".to_string())?;
        state.1.store(false, Ordering::Relaxed);
        if !safe_drive_id(&file_id) || !has_scope(&vault(&app)?, READONLY) {
            return Err("Se necesita permiso de lectura de Drive.".into());
        }
        let token = access(&app)?;
        let client = http()?;
        let file = response(
            client
                .get(format!("{API}/{file_id}"))
                .bearer_auth(&token)
                .query(&[("fields", "id,name,mimeType,size,parents,sha256Checksum")])
                .send()
                .map_err(|_| "No se pudo leer el libro.".to_string())?,
        )?;
        let format = source_format(&file).ok_or("Esta versión importa EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ.")?;
        let expected = checksum(&file);
        let (id, size) = download_book(&app, &client, &token, &file_id, &format, expected.as_deref())?;
        let source = binding(&id,&file,"");
        Ok(json!({"id":id,"format":format,"filename":file["name"],"size":size,"driveSource":source["driveSource"]}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pdf_sources_keep_original_bindings_and_pdf_mime() {
        assert_eq!(book_mime("pdf"), "application/pdf");
        let hash = "f".repeat(64);
        let original = json!({"id":"original-pdf","name":"LIBRO.PDF","mimeType":"application/pdf","sha256Checksum":hash,"parents":["nested"]});
        assert_eq!(source_format(&original), Some("pdf".into()));
        let book = json!({"id":hash,"format":"pdf"});
        assert_eq!(
            matching_file(&[original], &book).unwrap()["id"],
            "original-pdf"
        );
        assert!(source_format(
            &json!({"name":"Libro.pdf","mimeType":"application/vnd.google-apps.document"})
        )
        .is_none());
    }
    #[test]
    fn original_in_a_subfolder_is_reused_by_content_even_after_renaming() {
        let hash = "a".repeat(64);
        let book = json!({"id":hash,"format":"epub","title":"Mi título personalizado","driveSource":{"fileId":"original"}});
        let files = vec![
            json!({"id":"old-duplicate","name":"otra-copia.epub","folderId":"root","sha256":hash}),
            json!({"id":"original","name":"Nombre de Drive.epub","folderId":"nested-author","sha256":hash}),
        ];
        let original = matching_file(&files, &book).unwrap();
        assert_eq!(original["id"], "original");
        assert_eq!(
            binding(&hash, &original, "root")["driveSource"]["folderId"],
            "nested-author"
        );
    }
    #[test]
    fn changed_bytes_and_same_filename_do_not_count_as_the_original() {
        let hash = "a".repeat(64);
        let book = json!({"id":hash,"format":"epub","title":"Igual"});
        let stale = json!({"id":"changed","name":"Igual.epub","sha256Checksum":"b".repeat(64),"appProperties":{"sha256":hash}});
        assert!(matching_file(&[stale], &book).is_none());
        assert!(matching_file(
            &[json!({"id":"other-format","name":"Igual.txt","sha256":hash})],
            &book
        )
        .is_none());
    }
    #[test]
    #[cfg(windows)]
    fn windows_vault_encrypts_and_recovers_private_bytes() {
        let original = b"synthetic-refresh-token-for-local-test-only";
        let encrypted = windows_crypt(original, false).unwrap();
        assert!(!encrypted.windows(original.len()).any(|w| w == original));
        assert_eq!(windows_crypt(&encrypted, true).unwrap(), original);
    }
    #[test]
    fn pkce_matches_rfc7636_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn folder_links_reject_other_sites_and_query_injection() {
        assert_eq!(
            folder_id("https://drive.google.com/drive/u/0/folders/abc-123_456?usp=sharing")
                .unwrap(),
            "abc-123_456"
        );
        assert_eq!(folder_id("abc-123_456").unwrap(), "abc-123_456");
        assert!(folder_id("https://example.org/folders/abc").is_err());
        assert!(folder_id("abc' or trashed=true").is_err());
        assert!(folder_id("https://drive.google.com/file/d/abc/view").is_err());
    }
    #[test]
    fn pagination_collects_large_folders_and_stops_repeated_pages() {
        let mut requests = 0;
        let files=collect_pages(|page| {
            requests+=1; let n=if page.is_empty(){0}else{page.parse::<usize>().unwrap()};
            let mut result=json!({"files":(0..100).map(|i|json!({"id":format!("file-{n}-{i}")})).collect::<Vec<_>>()});
            if n<120 {result["nextPageToken"]=json!((n+1).to_string());}
            Ok(result)
        },||Ok(())).unwrap();
        assert_eq!(requests, 121);
        assert_eq!(files.len(), 12100);
        assert!(collect_pages(
            |_| Ok(json!({"files":[],"nextPageToken":"same"})),
            || Ok(())
        )
        .unwrap_err()
        .contains("repitió"));
    }
    #[test]
    fn recursive_scan_has_no_folder_count_or_book_size_cap_and_avoids_cycles() {
        let mut visited = 0;
        let (books,skipped)=scan_tree("root".into(),true,|id| {
            visited+=1;
            if id=="root" {return Ok((0..150).map(|n|json!({"id":format!("folder-{n}"),"mimeType":"application/vnd.google-apps.folder"})).collect());}
            let mut files:Vec<_>=(0..10).map(|n|json!({"id":format!("{id}-book-{n}"),"name":format!("{n}.epub"),"mimeType":"application/epub+zip","size":"3000000000"})).collect();
            files.push(json!({"id":"root","mimeType":"application/vnd.google-apps.folder"}));
            Ok(files)
        }).unwrap();
        assert_eq!(visited, 151);
        assert_eq!(books.len(), 1500);
        assert_eq!(skipped, 0);
        assert_eq!(books[0]["size"], 3_000_000_000u64);
    }
    #[test]
    fn chunked_upload_resumes_at_the_server_confirmed_offset() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url =
            url::Url::parse(&format!("http://{}/upload", listener.local_addr().unwrap())).unwrap();
        let size = 8 * 1024 * 1024 + 512;
        let path =
            std::env::temp_dir().join(format!("lector-upload-test-{}.bin", uuid::Uuid::new_v4()));
        fs::write(&path, vec![42u8; size]).unwrap();
        let server = std::thread::spawn(move || {
            for turn in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut received = vec![];
                let mut chunk = [0u8; 65536];
                let split = loop {
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    received.extend_from_slice(&chunk[..n]);
                    if let Some(p) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                        break p + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&received[..split]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .map(|n| n.trim().parse().unwrap())
                    })
                    .unwrap();
                let expected = if turn == 0 {
                    format!("content-range: bytes 0-8388607/{size}")
                } else {
                    format!("content-range: bytes 262144-{}/{size}", size - 1)
                };
                assert!(headers.contains(&expected));
                let mut read = received.len() - split;
                assert!(received[split..].iter().all(|b| *b == 42));
                while read < length {
                    let n = stream
                        .read(&mut chunk[..(length - read).min(65536)])
                        .unwrap();
                    assert!(n > 0);
                    assert!(chunk[..n].iter().all(|b| *b == 42));
                    read += n;
                }
                if turn == 0 {
                    stream.write_all(b"HTTP/1.1 308 Resume Incomplete\r\nRange: bytes=0-262143\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                } else {
                    let body = b"{\"id\":\"uploaded\"}";
                    write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
                    stream.write_all(body).unwrap();
                }
            }
        });
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        let result = upload_chunks(
            &client,
            "synthetic-local-test",
            url,
            fs::File::open(&path).unwrap(),
            size as u64,
            "application/epub+zip",
            || Ok(()),
            |_| {},
        );
        fs::remove_file(path).unwrap();
        assert_eq!(result.unwrap()["id"], "uploaded");
        server.join().unwrap();
    }
}

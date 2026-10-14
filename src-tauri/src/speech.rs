use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    process::{Child, ChildStdin},
    sync::{mpsc, Arc, Condvar, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
};
use tauri::{Emitter, Manager};
type Waiters = Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>;
struct Host {
    child: Child,
    input: ChildStdin,
    waiters: Waiters,
}
#[derive(Default)]
pub struct Speech(Mutex<Option<Host>>);
#[derive(Default)]
struct TimerState {
    generation: u64,
    deadline: Option<Instant>,
    deadline_ms: Option<u64>,
}
#[derive(Default)]
pub struct SleepTimer(Arc<(Mutex<TimerState>, Condvar)>);
impl SleepTimer {
    fn arm(&self, duration: Option<Duration>, now_ms: u64) -> Result<u64, String> {
        let deadline = duration
            .map(|d| {
                Instant::now()
                    .checked_add(d)
                    .ok_or("Duración del temporizador no válida.")
            })
            .transpose()?;
        let deadline_ms = duration
            .map(|d| {
                now_ms
                    .checked_add(d.as_millis() as u64)
                    .filter(|ms| *ms <= 9_007_199_254_740_991)
                    .ok_or("Duración del temporizador no válida.")
            })
            .transpose()?;
        let (lock, changed) = &*self.0;
        let mut state = lock.lock().map_err(|e| e.to_string())?;
        state.generation = state.generation.wrapping_add(1);
        state.deadline = deadline;
        state.deadline_ms = deadline_ms;
        changed.notify_all();
        Ok(state.generation)
    }
    fn status(&self) -> Result<Value, String> {
        let state = self.0 .0.lock().map_err(|e| e.to_string())?;
        Ok(json!({"deadline":state.deadline_ms}))
    }
    fn expire(&self, generation: u64, on_expired: impl FnOnce()) -> Result<bool, String> {
        let (lock, changed) = &*self.0;
        let mut state = lock.lock().map_err(|e| e.to_string())?;
        loop {
            if state.generation != generation {
                return Ok(false);
            }
            let Some(deadline) = state.deadline else {
                return Ok(false);
            };
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                state.deadline = None;
                state.deadline_ms = None;
                on_expired();
                return Ok(true);
            }
            state = changed
                .wait_timeout(state, remaining)
                .map_err(|e| e.to_string())?
                .0;
        }
    }
}
fn timer_duration(minutes: Option<f64>) -> Result<Option<Duration>, String> {
    minutes
        .map(|m| {
            let milliseconds = m * 60_000.0;
            if !m.is_finite()
                || m <= 0.0
                || !(1.0..=9_007_199_254_740_991.0).contains(&milliseconds)
            {
                return Err("Elige una duración positiva para el temporizador.".into());
            }
            Ok(Duration::from_millis(milliseconds.round() as u64))
        })
        .transpose()
}
fn cancel_running(app: &tauri::AppHandle) {
    let state = app.state::<Speech>();
    if let Ok(mut slot) = state.0.lock() {
        if let Some(host) = slot.as_mut() {
            let _ = writeln!(
                host.input,
                "{{\"requestId\":\"sleep-timer\",\"action\":\"cancel\"}}"
            );
            let _ = host.input.flush();
        }
    };
}
#[tauri::command]
pub fn speech_timer(app: tauri::AppHandle, minutes: Option<f64>) -> Result<Value, String> {
    let state = app.state::<SleepTimer>();
    let duration = timer_duration(minutes)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let generation = state.arm(duration, now)?;
    if duration.is_some() {
        let timer = SleepTimer(state.0.clone());
        let target = app.clone();
        std::thread::spawn(move || {
            let _ = timer.expire(generation, || {
                cancel_running(&target);
                let _ = target.emit("sleep-timer", json!({"expired":true}));
            });
        });
    }
    state.status()
}
#[tauri::command]
pub fn speech_timer_status(app: tauri::AppHandle) -> Result<Value, String> {
    app.state::<SleepTimer>().status()
}
#[cfg(not(windows))]
fn launch(_: &tauri::AppHandle) -> Result<Host, String> {
    Err("La voz para esta plataforma todavía no está disponible.".into())
}
#[cfg(windows)]
fn launch(app: &tauri::AppHandle) -> Result<Host, String> {
    let dir = crate::directory(app)?.join("native");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("SpeechHost.cs"),
        include_str!("../../native/windows/SpeechHost.cs"),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("PcmPlayback.cs"),
        include_str!("../../native/windows/PcmPlayback.cs"),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("speech-host.ps1"),
        include_str!("../../native/windows/speech-host.ps1"),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("voice-catalog.json"),
        include_str!("../../native/windows/voice-catalog.json"),
    )
    .map_err(|e| e.to_string())?;
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(dir.join("speech-host.ps1"))
        .env("LECTOR_VOICES_DIR", crate::directory(app)?.join("voices"))
        .env("LECTOR_VOICE_CATALOG", dir.join("voice-catalog.json"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let input = child.stdin.take().ok_or("No se abrió la entrada de voz")?;
    let output = child.stdout.take().ok_or("No se abrió la salida de voz")?;
    let waiters: Waiters = Default::default();
    let pending = waiters.clone();
    let target = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<Value>(&line) {
                if let Some(id) = event["requestId"].as_str() {
                    if let Ok(mut map) = pending.lock() {
                        if let Some(tx) = map.remove(id) {
                            let _ = tx.send(event.clone());
                        }
                    }
                }
                let _ = target.emit("speech-event", event);
            }
        }
        let _ = target.emit(
            "speech-event",
            json!({"type":"fault","error":"El servicio de voz se cerró."}),
        );
    });
    Ok(Host {
        child,
        input,
        waiters,
    })
}
#[tauri::command]
pub async fn speech_command(app: tauri::AppHandle, mut command: Value) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let action = command["action"].as_str().unwrap_or("").to_owned();
        let value = crate::mobile::mobile_speech(app, command).await?;
        return if action == "voices" {
            Ok(value["voices"].clone())
        } else {
            Ok(value)
        };
    }
    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Speech>();
        let mut host = state.0.lock().map_err(|e| e.to_string())?;
        let restart = match host.as_mut() {
            Some(h) => h.child.try_wait().map_err(|e| e.to_string())?.is_some(),
            None => true,
        };
        if restart {
            *host = Some(launch(&app)?);
        }
        let host = host.as_mut().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        command["requestId"] = json!(id);
        let (tx, rx) = mpsc::channel();
        host.waiters
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), tx);
        let serialized = serde_json::to_string(&command).map_err(|e| e.to_string())?;
        writeln!(host.input, "{serialized}")
            .and_then(|_| host.input.flush())
            .map_err(|e| e.to_string())?;
        let result = rx.recv_timeout(Duration::from_secs(25));
        host.waiters.lock().map_err(|e| e.to_string())?.remove(&id);
        let response = result.map_err(|_| "El servicio de voz no respondió".to_string())?;
        if response["ok"] == true {
            Ok(response["result"].clone())
        } else {
            Err(response["error"].as_str().unwrap_or("Error de voz").into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn stop(app: &tauri::AppHandle) {
    let _ = app.state::<SleepTimer>().arm(None, 0);
    let state = app.state::<Speech>();
    if let Ok(mut slot) = state.0.lock() {
        if let Some(mut host) = slot.take() {
            let _ = writeln!(
                host.input,
                "{{\"requestId\":\"exit\",\"action\":\"shutdown\"}}"
            );
            let _ = host.input.flush();
            let _ = host.child.kill();
            let _ = host.child.wait();
        }
    };
}

#[cfg(test)]
mod timer_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[test]
    fn expiry_runs_without_frontend_activity() {
        let timer = SleepTimer::default();
        let generation = timer.arm(Some(Duration::from_millis(5)), 1000).unwrap();
        assert_eq!(timer.status().unwrap()["deadline"], 1005);
        let expired = AtomicBool::new(false);
        assert!(timer
            .expire(generation, || expired.store(true, Ordering::SeqCst))
            .unwrap());
        assert!(expired.load(Ordering::SeqCst));
        assert!(timer.status().unwrap()["deadline"].is_null());
    }
    #[test]
    fn cancel_and_replacement_invalidate_prior_generation() {
        let timer = SleepTimer::default();
        let generation = timer.arm(Some(Duration::from_secs(60)), 1000).unwrap();
        timer.arm(None, 1001).unwrap();
        assert!(!timer
            .expire(generation, || panic!("cancelled timer fired"))
            .unwrap());
        let first = timer.arm(Some(Duration::from_secs(60)), 1002).unwrap();
        let second = timer.arm(Some(Duration::ZERO), 1003).unwrap();
        assert!(!timer
            .expire(first, || panic!("replaced timer fired"))
            .unwrap());
        assert!(timer.expire(second, || ()).unwrap());
    }
    #[test]
    fn validates_duration_and_deadline() {
        assert_eq!(
            timer_duration(Some(20.0)).unwrap(),
            Some(Duration::from_secs(1200))
        );
        assert_eq!(timer_duration(None).unwrap(), None);
        for m in [0.0, -1.0, f64::NAN, f64::INFINITY, 1e30] {
            assert!(timer_duration(Some(m)).is_err());
        }
        assert!(SleepTimer::default()
            .arm(Some(Duration::from_millis(2)), 9_007_199_254_740_991)
            .is_err());
    }
}

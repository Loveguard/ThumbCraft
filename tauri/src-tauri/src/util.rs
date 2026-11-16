// Shared helpers: the app's data folder, atomic writes, events to the window, and the binary
// packing used to hand files to the window without turning them into giant JSON arrays.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub type Res<T> = Result<T, String>;

/// Turns any error into the plain message the window shows.
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn app() -> &'static AppHandle {
    APP.get().expect("app handle not set")
}

/// Sends an event to the main window (progress lines, update notices, Claude requests).
pub fn emit<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to("main", event, payload);
    }
}

/// The per-user data folder, shared with the Electron build so settings, recovery copies, the generator
/// cache and the Claude bridge carry over: Roaming\ThumbCraft on Windows, Application Support/ThumbCraft
/// on macOS, ~/.config/ThumbCraft on Linux. Earlier names of the app (ThumbCrafter, BlockFrame) are kept
/// when only they exist.
pub fn user_data() -> &'static PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        let dir = base.join("ThumbCraft");
        if !dir.exists() {
            for legacy in ["ThumbCrafter", "BlockFrame"] {
                let p = base.join(legacy);
                if p.exists() {
                    return p;
                }
            }
        }
        let _ = fs::create_dir_all(&dir);
        dir
    })
}

/// A path inside the data folder.
pub fn cache_dir(parts: &[&str]) -> PathBuf {
    let mut p = user_data().clone();
    for part in parts {
        p.push(part);
    }
    p
}

/// Writes atomically (temp file + rename) so a crash mid-save never corrupts the previous copy.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Res<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

/// Files bundled with the app (MediaPipe, the secret scenes, the model dumper): the installed app's resource
/// folder, or the project folder while running from source.
pub fn resource_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(app) = APP.get() {
        if let Ok(dir) = app.path().resource_dir() {
            out.push(dir);
        }
    }
    out
}

/// The project folder (the one holding package.json) when running from source.
pub fn dev_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf)
    } else {
        None
    }
}

/// Paths the user picked in a dialog (or that came from our own scans) this session. Commands that read or
/// write files on the window's behalf only accept these, so a compromised page can't point the app at
/// arbitrary files.
static PICKED: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn add_picked(p: &Path) {
    PICKED.lock().unwrap().insert(p.to_path_buf());
}

pub fn picked(p: &str, what: &str) -> Res<PathBuf> {
    let path = PathBuf::from(p);
    if PICKED.lock().unwrap().contains(&path) {
        Ok(path)
    } else {
        Err(format!("Choose the {what} again"))
    }
}

/// One binary answer: a little-endian u32 length, a JSON header of that length, then raw bytes.
/// (The window unpacks it in platform/tauri.ts.)
pub fn packed(meta: &serde_json::Value, payload: &[u8]) -> tauri::ipc::Response {
    let head = serde_json::to_vec(meta).unwrap_or_else(|_| b"{}".to_vec());
    let mut out = Vec::with_capacity(4 + head.len() + payload.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(payload);
    tauri::ipc::Response::new(out)
}

/// The raw bytes a command was sent (the window passes a Uint8Array as the whole request body).
pub fn body_bytes(request: &tauri::ipc::Request<'_>) -> Res<Vec<u8>> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("Nothing to save".into()),
    }
}

/// A JSON header sent alongside raw bytes (percent-encoded, since headers are ASCII).
pub fn header_json(request: &tauri::ipc::Request<'_>) -> Res<serde_json::Value> {
    let Some(v) = request.headers().get("x-meta") else {
        return Ok(serde_json::Value::Null);
    };
    let text = percent_encoding::percent_decode(v.as_bytes()).decode_utf8().map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

/// A file name safe on every system (no folders, no reserved characters).
pub fn safe_file_name(name: &str, fallback: &str) -> String {
    let base = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || (c as u32) < 0x20 { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

/// Deletes a cache folder or file; one still locked (Windows) is left for the next clean-up.
pub fn remove_quietly(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

pub fn mtime_ms(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Starts a program without a console window (Windows) and, for background work, at a lower priority.
pub fn command(program: &Path, low_priority: bool) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | if low_priority { BELOW_NORMAL_PRIORITY_CLASS } else { 0 });
    }
    #[cfg(not(windows))]
    let _ = low_priority;
    cmd
}

/// Lowers a started process's priority on macOS and Linux (Windows sets it when starting).
pub fn lower_priority(_pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, _pid as libc::id_t, 10);
    }
}

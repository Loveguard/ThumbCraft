// Project files on disk: explicit saves (.bfproj anywhere the user chooses) plus automatic recovery copies in
// the app's data folder, which back the "Recent projects" list.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha1::{Digest, Sha1};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::dialogs;
use crate::util::{body_bytes, err, header_json, mtime_ms, now_ms, packed, user_data, write_atomic, Res};

fn dir() -> PathBuf {
    let d = user_data().join("projects");
    let _ = fs::create_dir_all(&d);
    d
}

fn index_file() -> PathBuf {
    dir().join("recent.json")
}

/// File name for a project id; anything unusual is hashed so two ids can never share a file.
fn safe_id(id: &str) -> String {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        id.to_string()
    } else {
        hex::encode(Sha1::digest(id.as_bytes()))
    }
}

/// Decodes an exported image (PNG or JPG data URL) and the extension it should be saved with.
pub fn image_bytes(data_url: &str) -> Res<(Vec<u8>, &'static str)> {
    let (ext, rest) = if let Some(r) = data_url.strip_prefix("data:image/png;base64,") {
        ("png", r)
    } else if let Some(r) = data_url.strip_prefix("data:image/jpeg;base64,") {
        ("jpg", r)
    } else {
        return Err("Expected a PNG or JPG image".into());
    };
    let bytes = base64::engine::general_purpose::STANDARD.decode(rest.trim()).map_err(err)?;
    Ok((bytes, ext))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    id: String,
    name: String,
    saved_path: Option<String>,
    updated_at: f64,
    minecraft_version: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    id: String,
    #[serde(default)]
    name: String,
    minecraft_version: Option<String>,
    saved_path: Option<String>,
    thumbnail: Option<String>,
}

static LOCK: Mutex<()> = Mutex::new(());

/// Paths the user picked in a save/open dialog this session. Only these (or ones already in the recent list,
/// which got there the same way) are ever written or read on the window's behalf.
static APPROVED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn read_index() -> Vec<IndexEntry> {
    fs::read_to_string(index_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_index(mut entries: Vec<IndexEntry>) -> Res<()> {
    entries.truncate(40);
    write_atomic(&index_file(), &serde_json::to_vec_pretty(&entries).map_err(err)?)
}

fn is_approved(p: &Option<String>) -> bool {
    match p {
        Some(p) if !p.is_empty() => {
            APPROVED.lock().unwrap().contains(p) || read_index().iter().any(|e| e.saved_path.as_deref() == Some(p))
        }
        _ => false,
    }
}

fn touch(id: &str, name: &str, saved_path: Option<String>, minecraft_version: Option<String>) -> Res<()> {
    let mut entries: Vec<IndexEntry> = read_index().into_iter().filter(|e| e.id != id).collect();
    entries.insert(
        0,
        IndexEntry { id: id.into(), name: name.into(), saved_path, updated_at: now_ms(), minecraft_version },
    );
    write_index(entries)
}

fn autosave_inner(bytes: &[u8], meta: &ProjectMeta) -> Res<()> {
    let _g = LOCK.lock().unwrap();
    let id = safe_id(&meta.id);
    write_atomic(&dir().join(format!("{id}.bfproj")), bytes)?;
    if let Some(t) = meta.thumbnail.as_deref().filter(|t| t.starts_with("data:image/png;base64,")) {
        let (png, _) = image_bytes(t)?;
        write_atomic(&dir().join(format!("{id}.png")), &png)?;
    }
    // Never trust a path from the window: keep the one we already know unless the user picked this one.
    let known = read_index().into_iter().find(|e| e.id == meta.id).and_then(|e| e.saved_path);
    let saved = if is_approved(&meta.saved_path) { meta.saved_path.clone() } else { known };
    touch(&meta.id, &meta.name, saved, meta.minecraft_version.clone())
}

fn meta_of(request: &tauri::ipc::Request<'_>) -> Res<ProjectMeta> {
    let v = header_json(request)?;
    let meta = v.get("meta").cloned().unwrap_or(serde_json::Value::Null);
    serde_json::from_value(meta).map_err(|_| "Invalid project details".to_string())
}

#[tauri::command]
pub async fn project_autosave(request: tauri::ipc::Request<'_>) -> Res<()> {
    let bytes = body_bytes(&request)?;
    let meta = meta_of(&request)?;
    tauri::async_runtime::spawn_blocking(move || autosave_inner(&bytes, &meta)).await.map_err(err)?
}

#[tauri::command]
pub async fn project_save(request: tauri::ipc::Request<'_>) -> Res<Option<String>> {
    let bytes = body_bytes(&request)?;
    let meta = meta_of(&request)?;
    let path = header_json(&request)?.get("path").and_then(|p| p.as_str()).map(str::to_string);
    let target = if is_approved(&path) {
        path.unwrap()
    } else {
        let name: String = meta.name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
        let name = if name.is_empty() { "thumbnail".to_string() } else { name };
        let Some(p) = dialogs::save("Save project", &format!("{name}.bfproj"), &[("ThumbCraft project", &["bfproj"])]).await
        else {
            return Ok(None);
        };
        let p = p.to_string_lossy().to_string();
        APPROVED.lock().unwrap().insert(p.clone());
        p
    };
    write_atomic(Path::new(&target), &bytes)?;
    let meta = ProjectMeta { saved_path: Some(target.clone()), ..meta };
    autosave_inner(&bytes, &meta)?;
    Ok(Some(target))
}

#[tauri::command]
pub async fn project_open() -> Res<tauri::ipc::Response> {
    // An empty answer means the dialog was cancelled.
    let Some(p) = dialogs::open_file("Open project", &[("ThumbCraft project", &["bfproj"])]).await else {
        return Ok(tauri::ipc::Response::new(vec![]));
    };
    let path = p.to_string_lossy().to_string();
    APPROVED.lock().unwrap().insert(path.clone());
    let bytes = fs::read(&p).map_err(err)?;
    Ok(packed(&json!({ "path": path }), &bytes))
}

#[tauri::command]
pub fn project_recent() -> Vec<serde_json::Value> {
    read_index()
        .into_iter()
        .filter(|e| {
            dir().join(format!("{}.bfproj", safe_id(&e.id))).exists()
                || e.saved_path.as_deref().is_some_and(|p| Path::new(p).exists())
        })
        .map(|e| {
            let png = dir().join(format!("{}.png", safe_id(&e.id)));
            let thumbnail = fs::read(&png)
                .ok()
                .map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)));
            json!({
                "id": e.id, "name": e.name, "savedPath": e.saved_path, "updatedAt": e.updated_at,
                "minecraftVersion": e.minecraft_version, "thumbnail": thumbnail
            })
        })
        .collect()
}

/// The newest copy of a recent project: the autosave, unless the saved file was modified later.
#[tauri::command]
pub fn project_open_recent(id: String) -> Res<tauri::ipc::Response> {
    let entry = read_index().into_iter().find(|e| e.id == id);
    let auto = dir().join(format!("{}.bfproj", safe_id(&id)));
    let saved = entry.and_then(|e| e.saved_path).filter(|p| Path::new(p).exists());
    let auto_time = if auto.exists() { mtime_ms(&auto) } else { -1.0 };
    let saved_time = saved.as_deref().map(|p| mtime_ms(Path::new(p))).unwrap_or(-1.0);
    let file = match &saved {
        Some(s) if saved_time > auto_time => PathBuf::from(s),
        _ => auto,
    };
    if !file.exists() {
        return Err("That project no longer exists".into());
    }
    let bytes = fs::read(&file).map_err(err)?;
    Ok(packed(&json!({ "path": saved }), &bytes))
}

#[tauri::command]
pub fn project_forget(id: String) -> Res<()> {
    let _g = LOCK.lock().unwrap();
    write_index(read_index().into_iter().filter(|e| e.id != id).collect())?;
    for ext in ["bfproj", "png"] {
        let _ = fs::remove_file(dir().join(format!("{}.{ext}", safe_id(&id))));
    }
    Ok(())
}

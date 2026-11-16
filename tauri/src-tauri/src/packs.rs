// Resource packs, stacked over the loaded jar's files the way Minecraft does it: the top pack wins, then the
// next one, then vanilla. The list (top first) is an app setting, like the game's own pack screen.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};

use crate::assets::{read_zip, Files, MAX_ENTRY};
use crate::settings;
use crate::util::{mtime_ms, Res};

/// What a pack may replace: block/item models and states, and textures (blocks, mobs, sky, font…).
fn is_pack_file(name: &str) -> bool {
    let Some(r) = name.strip_prefix("assets/minecraft/") else { return false };
    (r.starts_with("blockstates/") && r.ends_with(".json"))
        || ((r.starts_with("models/block/") || r.starts_with("models/item/")) && r.ends_with(".json"))
        || (r.starts_with("textures/") && r.ends_with(".png") && r.len() > "textures/.png".len())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PackSetting {
    pub path: String,
    pub enabled: bool,
}

pub fn pack_settings() -> Vec<PackSetting> {
    settings::get("resourcePacks")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            let path = v.get("path")?.as_str()?.to_string();
            Some(PackSetting { path, enabled: v.get("enabled").and_then(Value::as_bool).unwrap_or(false) })
        })
        .collect()
}

pub fn save_pack_settings(list: &[PackSetting]) {
    settings::set("resourcePacks", serde_json::to_value(list).unwrap_or(Value::Null));
}

/// Every file of a pack (zip or folder) under assets/minecraft, plus its pack.mcmeta and pack.png.
fn read_pack(path: &Path) -> Res<HashMap<String, Arc<[u8]>>> {
    let mut out = HashMap::new();
    let wanted = |n: &str| is_pack_file(n) || n == "pack.mcmeta" || n == "pack.png";
    if path.is_dir() {
        fn walk(root: &Path, dir: &Path, depth: u32, out: &mut HashMap<String, Arc<[u8]>>, wanted: &dyn Fn(&str) -> bool) {
            if depth > 12 {
                return;
            }
            let Ok(rd) = fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(root, &p, depth + 1, out, wanted);
                    continue;
                }
                let Ok(rel) = p.strip_prefix(root) else { continue };
                let name = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                if wanted(&name) && fs::metadata(&p).map(|m| m.len() < MAX_ENTRY).unwrap_or(false) {
                    if let Ok(b) = fs::read(&p) {
                        out.insert(name, Arc::from(b));
                    }
                }
            }
        }
        walk(path, path, 0, &mut out, &wanted);
        return Ok(out);
    }
    // Some packs are zipped with their folder inside: "MyPack/assets/minecraft/…".
    let split = |name: &str| -> Option<(String, String)> {
        // The earliest place where the rest is pack.mcmeta, pack.png or assets/minecraft/<something>.
        (0..name.len()).filter(|i| name.is_char_boundary(*i)).find_map(|i| {
            let inner = &name[i..];
            let hit = inner == "pack.mcmeta"
                || inner == "pack.png"
                || (inner.starts_with("assets/minecraft/") && inner.len() > "assets/minecraft/".len());
            hit.then(|| (name[..i].to_string(), inner.to_string()))
        })
    };
    let label = path.file_name().and_then(|n| n.to_str()).unwrap_or("The pack").to_string();
    let entries = read_zip(path, |n| split(n).is_some(), &label)?;
    let prefix = entries
        .iter()
        .filter_map(|(n, _)| split(n))
        .find(|(pre, inner)| inner == "pack.mcmeta" && !pre.contains("/assets/"))
        .map(|(pre, _)| pre)
        .unwrap_or_default();
    for (name, bytes) in entries {
        let inner = name.strip_prefix(prefix.as_str()).unwrap_or(&name).to_string();
        if wanted(&inner) {
            out.insert(inner, Arc::from(bytes));
        }
    }
    Ok(out)
}

/// The pack's description from pack.mcmeta (plain text or a text component).
fn description(meta: Option<&Arc<[u8]>>) -> String {
    let Some(meta) = meta else { return String::new() };
    let bytes = meta.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(meta);
    let Ok(v) = serde_json::from_slice::<Value>(bytes) else { return String::new() };
    fn text(v: &Value) -> String {
        match v {
            Value::String(s) => s.clone(),
            Value::Array(a) => a.iter().map(text).collect(),
            Value::Object(o) => format!(
                "{}{}",
                text(o.get("text").unwrap_or(&Value::Null)),
                text(o.get("extra").unwrap_or(&Value::Null))
            ),
            _ => String::new(),
        }
    }
    let d = text(v.get("pack").and_then(|p| p.get("description")).unwrap_or(&Value::Null));
    // Strip § formatting codes.
    let mut out = String::new();
    let mut chars = d.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

static CACHE: LazyLock<Mutex<HashMap<String, (f64, Arc<HashMap<String, Arc<[u8]>>>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn pack_files(path: &str) -> Res<Arc<HashMap<String, Arc<[u8]>>>> {
    let mtime = mtime_ms(Path::new(path));
    if let Some((t, f)) = CACHE.lock().unwrap().get(path) {
        if *t == mtime {
            return Ok(f.clone());
        }
    }
    let files = Arc::new(read_pack(Path::new(path))?);
    CACHE.lock().unwrap().insert(path.to_string(), (mtime, files.clone()));
    Ok(files)
}

fn pack_name(path: &str) -> String {
    let base = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or(path);
    if base.to_lowercase().ends_with(".zip") {
        base[..base.len() - 4].to_string()
    } else {
        base.to_string()
    }
}

/// The pack list for the Look tab, with names, descriptions and icons; missing packs are marked.
pub fn list_packs() -> Vec<Value> {
    pack_settings()
        .into_iter()
        .map(|PackSetting { path, enabled }| {
            let name = pack_name(&path);
            let missing = |d: String| {
                json!({ "path": path, "enabled": enabled, "name": name, "description": d, "icon": null, "missing": true, "textures": 0 })
            };
            if !Path::new(&path).exists() {
                return missing(String::new());
            }
            match pack_files(&path) {
                Ok(files) => {
                    let icon = files.get("pack.png").map(|b| {
                        format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))
                    });
                    let textures = files.keys().filter(|k| k.ends_with(".png") && *k != "pack.png").count();
                    json!({
                        "path": path, "enabled": enabled, "name": name,
                        "description": description(files.get("pack.mcmeta")),
                        "icon": icon, "missing": false, "textures": textures
                    })
                }
                Err(e) => missing(e),
            }
        })
        .collect()
}

/// Checks that a file or folder is a resource pack; errors with a readable reason when not.
pub fn check_pack(path: &Path) -> Res<()> {
    let files = read_pack(path)?;
    if !files.keys().any(|k| is_pack_file(k)) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("That");
        return Err(format!(
            "{name} has no Minecraft textures or models (assets/minecraft/…), so it isn't a resource pack"
        ));
    }
    Ok(())
}

/// `base` with every enabled pack laid over it, bottom pack first so the top one wins.
pub fn with_packs(base: &Files) -> (Files, Vec<String>) {
    let enabled: Vec<PackSetting> =
        pack_settings().into_iter().filter(|p| p.enabled && Path::new(&p.path).exists()).collect();
    if enabled.is_empty() {
        return (base.clone(), vec![]);
    }
    let mut files = base.clone();
    let mut applied = Vec::new();
    for p in enabled.iter().rev() {
        // An unreadable pack is skipped (the list shows it).
        if let Ok(pf) = pack_files(&p.path) {
            for (name, bytes) in pf.iter() {
                if is_pack_file(name) {
                    files.insert(name.clone(), bytes.clone());
                }
            }
            applied.insert(0, pack_name(&p.path));
        }
    }
    (files, applied)
}

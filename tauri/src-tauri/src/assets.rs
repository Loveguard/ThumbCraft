// Locates the user's Minecraft installation and reads block assets straight out of the client jar.
// We never ship Mojang's files: everything is read locally from the user's own copy of the game.
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use crate::compat::{is_supported, locate_command, release_time_of};
use crate::packs;
use crate::util::{cache_dir, err, mtime_ms, Res};

pub type Files = HashMap<String, Arc<[u8]>>;

const KEEP: [&str; 14] = [
    "assets/minecraft/blockstates/",
    "assets/minecraft/models/block/",
    "assets/minecraft/models/item/",
    "assets/minecraft/textures/item/",
    // Armor: 1.21.2+ keeps it under textures/entity/equipment; older versions under textures/models/armor.
    "assets/minecraft/textures/models/armor/",
    "assets/minecraft/textures/block/",
    "assets/minecraft/textures/colormap/",
    "assets/minecraft/textures/entity/",
    "assets/minecraft/textures/particle/",
    "assets/minecraft/textures/environment/",
    "assets/minecraft/textures/font/",
    "data/minecraft/worldgen/biome/",
    // Vanilla structure templates (village houses, igloos, shipwrecks…); "structures" before 1.21.
    "data/minecraft/structure/",
    "data/minecraft/structures/",
];

/// Game assets are small; a huge entry means a corrupt or doctored jar.
pub const MAX_ENTRY: u64 = 64 * 1024 * 1024;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Per-user app data folder (Roaming on Windows, Application Support on macOS, ~/.local/share on Linux).
fn app_data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(home)
}

/// Folders laid out like .minecraft (versions/<id>/<id>.jar plus libraries/): the official launcher first,
/// then launchers that copy its layout, then versions ThumbCraft downloaded itself.
pub fn minecraft_roots() -> Vec<PathBuf> {
    let data = app_data_dir();
    let official = if cfg!(windows) {
        data.join(".minecraft")
    } else if cfg!(target_os = "macos") {
        data.join("minecraft")
    } else {
        home().join(".minecraft")
    };
    vec![
        official,
        data.join("ModrinthApp").join("meta"),
        data.join("com.modrinth.theseus").join("meta"),
        home().join("curseforge").join("minecraft").join("Install"),
        home().join(".var/app/com.mojang.Minecraft/.minecraft"),
        cache_dir(&["clients"]),
    ]
}

/// Prism Launcher keeps vanilla client jars as libraries/com/mojang/minecraft/<v>/minecraft-<v>-client.jar.
fn prism_roots() -> Vec<PathBuf> {
    vec![app_data_dir().join("PrismLauncher"), home().join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher")]
}

/// The game version a jar holds, from its file name (Prism names them minecraft-<v>-client.jar).
pub fn version_of_jar(jar: &Path) -> String {
    let name = jar.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let name = name.strip_suffix(".jar").unwrap_or(name);
    match name.strip_prefix("minecraft-").and_then(|n| n.strip_suffix("-client")) {
        Some(v) => v.to_string(),
        None => name.to_string(),
    }
}

/// The launcher's version json for a version id (next to the jar, or in any .minecraft folder).
pub fn version_json_path(id: &str, jar: Option<&Path>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = jar.and_then(Path::parent) {
        candidates.push(dir.join(format!("{id}.json")));
    }
    for r in minecraft_roots() {
        candidates.push(r.join("versions").join(id).join(format!("{id}.json")));
    }
    candidates.into_iter().find(|p| p.exists())
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The vanilla version a profile builds on and its release date (follows inheritsFrom for modded profiles).
fn release_of(id: &str, jar: Option<&Path>) -> (String, Option<String>) {
    let mut release_time = None;
    let mut cur = id.to_string();
    for i in 0..4 {
        let Some(file) = version_json_path(&cur, if i == 0 { jar } else { None }) else { break };
        let Some(json) = read_json(&file) else { break };
        if let Some(parent) = json.get("inheritsFrom").and_then(Value::as_str) {
            cur = parent.to_string();
        } else {
            release_time = json.get("releaseTime").and_then(Value::as_str).map(str::to_string);
            break;
        }
    }
    (cur, release_time)
}

/// Command the generator server uses to find a biome in this version.
pub fn locate_command_of(id: &str) -> &'static str {
    let (base, time) = release_of(id, None);
    locate_command(&base, time.as_deref())
}

fn subdirs(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|r| r.flatten().filter_map(|e| e.file_name().to_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// Every client jar the launchers on this computer have downloaded.
fn installed_jars() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for root in minecraft_roots() {
        let dir = root.join("versions");
        for id in subdirs(&dir) {
            let jar = dir.join(&id).join(format!("{id}.jar"));
            out.push((id, jar));
        }
    }
    for root in prism_roots() {
        let dir = root.join("libraries/com/mojang/minecraft");
        for id in subdirs(&dir) {
            let jar = dir.join(&id).join(format!("minecraft-{id}-client.jar"));
            out.push((id, jar));
        }
    }
    out.into_iter().filter(|(_, j)| j.exists()).collect()
}

/// Installed jars ThumbCraft can use (1.18+), newest Minecraft version first.
pub fn newest_jars() -> Vec<PathBuf> {
    let mut list: Vec<(f64, f64, PathBuf)> = installed_jars()
        .into_iter()
        .filter_map(|(id, jar)| {
            let (base, time) = release_of(&id, Some(&jar));
            is_supported(&base, time.as_deref())
                .then(|| (release_time_of(&base, time.as_deref()), mtime_ms(&jar), jar))
        })
        .collect();
    list.sort_by(|a, b| b.0.total_cmp(&a.0).then(b.1.total_cmp(&a.1)));
    list.into_iter().map(|(_, _, j)| j).collect()
}

#[derive(Default)]
struct Loaded {
    /// The files we need from the loaded jar, with the resource packs laid over it.
    files: Files,
    /// The jar's own files (vanilla), kept so packs can be switched without reading the jar again.
    jar_files: Files,
    reloads: u64,
    version: String,
    jar: String,
    obfuscated: bool,
}

static STATE: LazyLock<Mutex<Loaded>> = LazyLock::new(|| Mutex::new(Loaded::default()));

pub fn current_version() -> String {
    STATE.lock().unwrap().version.clone()
}

pub fn current_jar() -> String {
    STATE.lock().unwrap().jar.clone()
}

/// Releases before 26.1 ship with obfuscated class names (mapped back with Mojang's official mappings).
pub fn is_obfuscated() -> bool {
    STATE.lock().unwrap().obfuscated
}

/// Width/height of every entity texture, read from the PNG headers.
pub fn entity_texture_sizes() -> Map<String, Value> {
    let st = STATE.lock().unwrap();
    let mut out = Map::new();
    for (name, bytes) in &st.files {
        let Some(rest) = name.strip_prefix("assets/minecraft/textures/entity/") else { continue };
        let Some(rest) = rest.strip_suffix(".png") else { continue };
        if bytes.len() < 24 {
            continue;
        }
        let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        out.insert(format!("entity/{rest}"), json!([w, h]));
    }
    out
}

pub fn read_asset(path: &str) -> Option<Arc<[u8]>> {
    STATE.lock().unwrap().files.get(&format!("assets/minecraft/{path}")).cloned()
}

/// Raw bytes of a vanilla structure template, by id like "village/plains/houses/plains_small_house_1".
pub fn read_structure(id: &str) -> Option<Arc<[u8]>> {
    let st = STATE.lock().unwrap();
    st.files
        .get(&format!("data/minecraft/structure/{id}.nbt"))
        .or_else(|| st.files.get(&format!("data/minecraft/structures/{id}.nbt")))
        .cloned()
}

/// Colours appear as ints in older data and as "#rrggbb" strings in newer environment attributes.
fn colour(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => {
            let h = s.trim_start_matches('#');
            (h.len() == 6).then(|| i64::from_str_radix(h, 16).ok()).flatten()
        }
        Value::Object(o) => o.get("value").and_then(colour),
        _ => None,
    }
}

pub fn normalize_biome(id: &str, raw: &Value) -> Value {
    let empty = Map::new();
    let effects = raw.get("effects").and_then(Value::as_object).unwrap_or(&empty);
    let attributes = raw.get("attributes").and_then(Value::as_object).unwrap_or(&empty);
    let pick = |key: &str| -> Value {
        if let Some(v) = effects.get(key) {
            return colour(v).map(Value::from).unwrap_or(Value::Null);
        }
        attributes
            .iter()
            .find(|(k, _)| k.ends_with(&format!("/{key}")) || k.ends_with(&format!(":{key}")))
            .and_then(|(_, v)| colour(v))
            .map(Value::from)
            .unwrap_or(Value::Null)
    };
    let num = |v: Option<&Value>, d: f64| v.and_then(Value::as_f64).unwrap_or(d);
    let mut fx = Map::new();
    for key in ["sky_color", "fog_color", "water_color", "water_fog_color", "grass_color", "foliage_color", "dry_foliage_color"] {
        let v = pick(key);
        if !v.is_null() {
            fx.insert(key.into(), v);
        }
    }
    if let Some(m) = effects.get("grass_color_modifier") {
        fx.insert("grass_color_modifier".into(), m.clone());
    }
    json!({
        "id": id,
        "temperature": num(raw.get("temperature"), 0.5),
        "downfall": num(raw.get("downfall"), 0.5),
        "effects": fx
    })
}

/// Reads the entries of a zip whose names pass `keep`, refusing oversized ones.
pub fn read_zip(path: &Path, mut keep: impl FnMut(&str) -> bool, what: &str) -> Res<Vec<(String, Vec<u8>)>> {
    let file = fs::File::open(path).map_err(err)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| format!("{what} isn't a readable zip file ({e})"))?;
    let mut out = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(err)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if !keep(&name) {
            continue;
        }
        if entry.size() > MAX_ENTRY {
            return Err(format!("{what} contains an oversized file ({name})"));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.by_ref().take(MAX_ENTRY + 1).read_to_end(&mut bytes).map_err(err)?;
        out.push((name, bytes));
    }
    Ok(out)
}

pub fn load_jar(jar: &Path) -> Res<Value> {
    let label = jar.file_name().and_then(|n| n.to_str()).unwrap_or("The jar").to_string();
    let mut has_mojang_names = false;
    let entries = read_zip(
        jar,
        |name| {
            if name == "net/minecraft/client/model/geom/LayerDefinitions.class" {
                has_mojang_names = true;
            }
            KEEP.iter().any(|p| name.starts_with(p))
        },
        &label,
    )?;
    if !entries.iter().any(|(n, _)| n.starts_with("assets/minecraft/blockstates/")) {
        return Err(format!("{label} doesn't look like a Minecraft client jar (no blockstates found)"));
    }
    let id = version_of_jar(jar);
    let (base, time) = release_of(&id, Some(jar));
    if !is_supported(&base, time.as_deref()) {
        return Err(format!("ThumbCraft needs Minecraft 1.18 or newer (this is {id})."));
    }
    {
        let mut st = STATE.lock().unwrap();
        st.jar_files = entries.into_iter().map(|(n, b)| (n, Arc::from(b))).collect();
        st.version = id;
        st.jar = jar.to_string_lossy().to_string();
        st.obfuscated = !has_mojang_names;
    }
    Ok(bundle_with_packs())
}

fn parse_json(bytes: &[u8]) -> Option<Value> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    serde_json::from_slice(bytes).ok()
}

/// The loaded jar's bundle with the current resource packs applied (after the pack list changed).
pub fn bundle_with_packs() -> Value {
    let jar_files = STATE.lock().unwrap().jar_files.clone();
    let (merged, applied) = packs::with_packs(&jar_files);
    let mut blockstates = Map::new();
    let mut models = Map::new();
    let mut biomes = Map::new();
    let mut textures = Vec::new();
    let mut structures = Vec::new();
    for (name, bytes) in &merged {
        if let Some(r) = name.strip_prefix("assets/minecraft/blockstates/").and_then(|r| r.strip_suffix(".json")) {
            if let Some(v) = parse_json(bytes) {
                blockstates.insert(r.into(), v);
            }
        } else if let Some(r) = name.strip_prefix("assets/minecraft/models/").and_then(|r| r.strip_suffix(".json")) {
            if r.starts_with("block/") || r.starts_with("item/") {
                if let Some(v) = parse_json(bytes) {
                    models.insert(r.into(), v);
                }
            }
        } else if let Some(r) = name.strip_prefix("data/minecraft/worldgen/biome/").and_then(|r| r.strip_suffix(".json")) {
            if let Some(v) = parse_json(bytes) {
                biomes.insert(r.into(), normalize_biome(r, &v));
            }
        } else if let Some(r) = name.strip_prefix("assets/minecraft/textures/").and_then(|r| r.strip_suffix(".png")) {
            textures.push(r.to_string());
        } else if let Some(r) = name
            .strip_prefix("data/minecraft/structure/")
            .or_else(|| name.strip_prefix("data/minecraft/structures/"))
            .and_then(|r| r.strip_suffix(".nbt"))
        {
            structures.push(r.to_string());
        }
    }
    structures.sort();
    let mut st = STATE.lock().unwrap();
    st.files = merged;
    st.reloads += 1;
    json!({
        "version": st.version,
        "blockstates": blockstates,
        "models": models,
        "biomes": biomes,
        "textures": textures,
        "structures": structures,
        "packs": applied,
        // Changes whenever the textures do, so the window never shows a cached texture from before.
        "stamp": st.reloads.to_string()
    })
}

/// Java runtimes the official launcher has downloaded, ones ThumbCraft installed, JAVA_HOME and the standard
/// install folders (a newer Java there may sit behind an older one on PATH).
pub fn launcher_java_candidates() -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "java.exe" } else { "java" };
    let mut roots: Vec<PathBuf> = minecraft_roots().into_iter().map(|r| r.join("runtime")).collect();
    if cfg!(windows) {
        if let Some(local) = dirs::data_local_dir() {
            roots.push(local.join("Packages/Microsoft.4297127D64EC6_8wekyb3d8bbwe/LocalCache/Local/runtime"));
        }
    }
    roots.push(cache_dir(&["java"]));
    let mut found = Vec::new();
    fn walk(dir: &Path, depth: u32, exe: &str, found: &mut Vec<PathBuf>) {
        // The macOS launcher's runtime sits deep: runtime/<c>/mac-os-arm64/<c>/jre.bundle/Contents/Home/bin
        if depth > 9 {
            return;
        }
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                walk(&p, depth + 1, exe, found);
            } else if e.file_name() == exe && dir.file_name().is_some_and(|n| n == "bin") {
                found.push(p);
            }
        }
    }
    for r in &roots {
        walk(r, 0, exe, &mut found);
    }
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let p = Path::new(&home).join("bin").join(exe);
        if p.exists() {
            found.push(p);
        }
    }
    let install_dirs: Vec<PathBuf> = if cfg!(windows) {
        ["ProgramFiles", "ProgramFiles(x86)"]
            .iter()
            .filter_map(|v| std::env::var(v).ok())
            .flat_map(|pf| {
                ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft", "Semeru"]
                    .map(|v| Path::new(&pf).join(v))
            })
            .collect()
    } else if cfg!(target_os = "macos") {
        vec![PathBuf::from("/Library/Java/JavaVirtualMachines"), home().join("Library/Java/JavaVirtualMachines")]
    } else {
        vec![PathBuf::from("/usr/lib/jvm")]
    };
    for dir in install_dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            for bin in [e.path().join("bin").join(exe), e.path().join("Contents/Home/bin").join(exe)] {
                if bin.exists() {
                    found.push(bin);
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|p| seen.insert(p.clone()));
    found
}

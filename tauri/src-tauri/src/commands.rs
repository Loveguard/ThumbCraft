// The commands the window calls (the same API the Electron preload exposed as window.blockframe; the window
// side is renderer/src/platform/tauri.ts). Slow work runs on blocking threads so the window never stalls.
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::util::{add_picked, body_bytes, emit, err, header_json, packed, picked, safe_file_name, Res};
use crate::{assets, claude, dialogs, fonts, generator, java, mobs, mojang, packs, projects, settings};

/// Runs blocking work off the async runtime's threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

// ------------------------------------------------------------------ Minecraft jar

/// No version picker: use the newest Minecraft on this computer (or the jar chosen when none was found).
#[tauri::command]
pub async fn mc_load_newest() -> Res<Option<Value>> {
    blocking(|| {
        let last = settings::get_str("lastJar");
        let jars = assets::newest_jars();
        let list = if jars.is_empty() { last.map(PathBuf::from).into_iter().collect() } else { jars };
        for jar in list {
            // A broken or half-downloaded jar: try the next newest.
            if let Ok(bundle) = assets::load_jar(&jar) {
                add_picked(&jar);
                settings::set("lastJar", json!(jar.to_string_lossy()));
                return Ok(Some(bundle));
            }
        }
        Ok(None)
    })
    .await
}

#[tauri::command]
pub async fn mc_pick_jar() -> Option<String> {
    dialogs::open_file("Choose a Minecraft client jar", &[("Minecraft client", &["jar"])])
        .await
        .map(|p| p.to_string_lossy().into())
}

#[tauri::command]
pub async fn mc_pick_world() -> Option<String> {
    dialogs::open_folder("Choose a Minecraft world folder").await.map(|p| p.to_string_lossy().into())
}

#[tauri::command]
pub async fn mc_load_jar(path: String) -> Res<Value> {
    let jar = picked(&path, "Minecraft jar")?;
    blocking(move || {
        let bundle = assets::load_jar(&jar)?;
        settings::set("lastJar", json!(jar.to_string_lossy()));
        Ok(bundle)
    })
    .await
}

#[tauri::command]
pub async fn mc_find_java() -> Res<Option<Value>> {
    blocking(|| Ok(java::java_info(&assets::current_version()))).await
}

#[tauri::command]
pub async fn java_install() -> Res<Option<Value>> {
    blocking(|| {
        let need = java::required_java(&assets::current_version());
        java::install_java(need, &|m| emit("java:progress", m))?;
        java::rescan();
        Ok(java::java_info(&assets::current_version()))
    })
    .await
}

#[tauri::command]
pub async fn mc_download_client() -> Res<String> {
    blocking(|| {
        let jar = mojang::download_latest_client(&crate::util::cache_dir(&["clients"]), &|m| emit("mc:clientProgress", m))?;
        add_picked(&jar);
        Ok(jar.to_string_lossy().into())
    })
    .await
}

#[tauri::command]
pub fn mc_eula_accepted() -> bool {
    settings::eula_accepted()
}

/// Saved as soon as the box is ticked, so the generator can warm up before the first Generate.
#[tauri::command]
pub fn mc_accept_eula() {
    settings::set("eulaAccepted", json!(true));
}

#[tauri::command]
pub async fn skin_fetch(username: String) -> Res<Value> {
    blocking(move || mojang::fetch_skin(&username)).await
}

// ------------------------------------------------------------------ terrain

/// The user's generation in progress, so Cancel can stop it.
static GENERATION: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

#[tauri::command]
pub async fn terrain_generate(req: generator::GenerateRequest) -> Res<tauri::ipc::Response> {
    if req.accept_eula {
        settings::set("eulaAccepted", json!(true));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(old) = GENERATION.lock().unwrap().replace(cancel.clone()) {
        old.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    let progress: generator::Progress =
        Arc::new(|stage: &str, message: &str| emit("terrain:progress", json!({ "stage": stage, "message": message })));
    let c2 = cancel.clone();
    let result = blocking(move || generator::generate(req, progress, c2)).await;
    let mut g = GENERATION.lock().unwrap();
    if g.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
        *g = None;
    }
    result.map(|bytes| tauri::ipc::Response::new(bytes))
}

/// Stops waiting for the current generation; the warm server keeps running for the next one.
#[tauri::command]
pub fn terrain_cancel() {
    if let Some(c) = GENERATION.lock().unwrap().as_ref() {
        c.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn terrain_prefetch(version: String, dimension: String, biome: String, size: f64) {
    std::thread::spawn(move || generator::prefetch(&version, &dimension, &biome, size));
}

#[tauri::command]
pub async fn terrain_prewarm(version: String, biomes: Vec<String>, size: f64) -> Res<()> {
    let size = if size > 0.0 { size } else { 48.0 };
    blocking(move || {
        generator::prewarm(&version, &biomes, size);
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldImportRequest {
    world_dir: String,
    dimension: String,
    center_x: f64,
    center_z: f64,
    center_y: Option<f64>,
    size: f64,
}

#[tauri::command]
pub async fn terrain_import(req: WorldImportRequest) -> Res<tauri::ipc::Response> {
    if req.size.fract() != 0.0 || !(1.0..=512.0).contains(&req.size) {
        return Err("Invalid area size".into());
    }
    // The dimension becomes part of a folder path: only the three real ones.
    if !["overworld", "the_nether", "the_end"].contains(&req.dimension.as_str()) {
        return Err("Invalid dimension".into());
    }
    let coord = |n: f64| n.fract() == 0.0 && n.abs() <= 30_000_000.0;
    if !coord(req.center_x) || !coord(req.center_z) || req.center_y.is_some_and(|y| !coord(y)) {
        return Err("Invalid coordinates".into());
    }
    let world = picked(&req.world_dir, "world folder")?;
    blocking(move || {
        generator::import_world(
            &world,
            &req.dimension,
            req.center_x as i32,
            req.center_y.map(|y| y as i32),
            req.center_z as i32,
            req.size as usize,
        )
    })
    .await
    .map(tauri::ipc::Response::new)
}

// ------------------------------------------------------------------ structures, schematics, mobs

/// A vanilla structure template's raw bytes (the window turns it into terrain with shared/minecraft code).
#[tauri::command]
pub fn structure_load(id: String) -> Res<tauri::ipc::Response> {
    let bytes = assets::read_structure(&id).ok_or_else(|| format!("No structure \"{id}\" in this Minecraft version"))?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[tauri::command]
pub async fn schematic_import() -> Res<tauri::ipc::Response> {
    let Some(file) =
        dialogs::open_file("Import a schematic", &[("Schematics", &["schem", "litematic", "nbt", "schematic"])]).await
    else {
        return Ok(cancelled());
    };
    let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("schematic").to_string();
    if fs::metadata(&file).map(|m| m.len()).unwrap_or(0) > 256 * 1024 * 1024 {
        return Err("That file is too large".into());
    }
    let bytes = fs::read(&file).map_err(err)?;
    Ok(packed(&json!({ "name": name }), &bytes))
}

/// An empty answer: the dialog was cancelled.
fn cancelled() -> tauri::ipc::Response {
    tauri::ipc::Response::new(vec![])
}

/// Mojang's mappings when the mob export needs them (see mobs.rs); None otherwise.
#[tauri::command]
pub async fn mobs_mappings() -> Res<Option<String>> {
    blocking(mobs::mappings_needed).await
}

#[tauri::command]
pub async fn mobs_load(names: Option<String>) -> Res<Value> {
    blocking(move || mobs::load(names, &|line| emit("mobs:progress", line))).await
}

// ------------------------------------------------------------------ resource packs and fonts

#[tauri::command]
pub async fn packs_list() -> Res<Vec<Value>> {
    blocking(|| Ok(packs::list_packs())).await
}

#[tauri::command]
pub async fn packs_add(folder: bool) -> Res<Vec<Value>> {
    let chosen = if folder {
        dialogs::open_folder("Choose a resource pack folder").await.into_iter().collect()
    } else {
        dialogs::open_files("Choose resource packs", &[("Resource pack", &["zip"])]).await
    };
    blocking(move || {
        let mut list = packs::pack_settings();
        let mut errors = Vec::new();
        for path in chosen {
            let p = path.to_string_lossy().to_string();
            if list.iter().any(|x| x.path == p) {
                continue;
            }
            match packs::check_pack(&path) {
                Ok(()) => list.insert(0, packs::PackSetting { path: p, enabled: true }),
                Err(e) => errors.push(e),
            }
        }
        packs::save_pack_settings(&list);
        if !errors.is_empty() {
            return Err(errors.join("\n"));
        }
        Ok(packs::list_packs())
    })
    .await
}

#[tauri::command]
pub async fn packs_set(list: Vec<Value>) -> Res<Option<Value>> {
    blocking(move || {
        // Only packs already in the list (added through the picker) can be kept; new paths can't come in this way.
        let known: Vec<String> = packs::pack_settings().into_iter().map(|p| p.path).collect();
        let next: Vec<packs::PackSetting> = list
            .into_iter()
            .filter_map(|v| {
                let path = v["path"].as_str()?.to_string();
                known.contains(&path).then(|| packs::PackSetting { path, enabled: v["enabled"].as_bool().unwrap_or(false) })
            })
            .collect();
        packs::save_pack_settings(&next);
        Ok((!assets::current_jar().is_empty()).then(assets::bundle_with_packs))
    })
    .await
}

#[tauri::command]
pub async fn fonts_list() -> Res<Value> {
    blocking(|| Ok(json!(fonts::list()))).await
}

#[tauri::command]
pub async fn fonts_read(path: String, index: usize) -> Res<tauri::ipc::Response> {
    blocking(move || fonts::read(&path, index)).await.map(tauri::ipc::Response::new)
}

// ------------------------------------------------------------------ exports and data files

fn strip_ext(name: &str, exts: &[&str]) -> String {
    let lower = name.to_lowercase();
    for e in exts {
        if lower.ends_with(&format!(".{e}")) {
            return name[..name.len() - e.len() - 1].to_string();
        }
    }
    name.to_string()
}

#[tauri::command]
pub async fn file_save_png(data_url: String, name: String) -> Res<Option<String>> {
    let (bytes, ext) = projects::image_bytes(&data_url)?;
    let filter: dialogs::Filter = if ext == "png" { ("PNG image", &["png"]) } else { ("JPG image", &["jpg", "jpeg"]) };
    let default = format!("{}.{ext}", strip_ext(&name, &["png", "jpg", "jpeg"]));
    let Some(p) = dialogs::save("Export thumbnail", &default, &[filter]).await else { return Ok(None) };
    fs::write(&p, bytes).map_err(err)?;
    Ok(Some(p.to_string_lossy().into()))
}

#[tauri::command]
pub async fn file_save_psd(request: tauri::ipc::Request<'_>) -> Res<Option<String>> {
    let bytes = body_bytes(&request)?;
    let name = header_json(&request)?["name"].as_str().unwrap_or("thumbnail").to_string();
    let default = format!("{}.psd", strip_ext(&name, &["psd"]));
    let Some(p) = dialogs::save("Export layers for Photoshop", &default, &[("Photoshop file", &["psd"])]).await else {
        return Ok(None);
    };
    fs::write(&p, bytes).map_err(err)?;
    Ok(Some(p.to_string_lossy().into()))
}

/// A video is rendered after its file is chosen (rendering takes a while); only that file can then be written.
static VIDEO_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

#[tauri::command]
pub async fn file_choose_video(name: String, ext: String) -> Option<String> {
    let kind: &'static str = match ext.as_str() {
        "mp4" => "mp4",
        "gif" => "gif",
        "zip" => "zip",
        _ => "webm",
    };
    let label = match kind {
        "mp4" => "MP4 video",
        "gif" => "GIF",
        "zip" => "Zip of PNG frames",
        _ => "WebM video",
    };
    let default = format!("{}.{kind}", strip_ext(&name, &["mp4", "webm", "gif", "zip"]));
    let exts: [&str; 1] = [kind];
    let p = dialogs::save("Export animation", &default, &[(label, &exts)]).await;
    *VIDEO_PATH.lock().unwrap() = p.clone();
    p.map(|p| p.to_string_lossy().into())
}

#[tauri::command]
pub async fn file_write_video(request: tauri::ipc::Request<'_>) -> Res<String> {
    let bytes = body_bytes(&request)?;
    let path = VIDEO_PATH.lock().unwrap().take().ok_or("Nothing to save")?;
    fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into())
}

/// Preset packs, Blockbench animations, sound and glTF models: a fixed list of kinds, each with its own extensions.
fn data_kind(kind: &str) -> Option<(&'static str, &'static [&'static str])> {
    Some(match kind {
        "presets" => ("ThumbCraft preset pack", &["thumbpack"]),
        "blockbench" => ("Blockbench animation", &["json"]),
        "audio" => ("Sound", &["mp3", "wav", "ogg", "m4a", "flac", "aac", "webm"]),
        "glb" => ("glTF model (Blender)", &["glb"]),
        _ => return None,
    })
}

#[tauri::command]
pub async fn file_save_data(request: tauri::ipc::Request<'_>) -> Res<Option<String>> {
    let bytes = body_bytes(&request)?;
    let head = header_json(&request)?;
    let (label, exts) = data_kind(head["kind"].as_str().unwrap_or("")).ok_or("Nothing to save")?;
    let ext = exts[0];
    let default = format!("{}.{ext}", strip_ext(head["name"].as_str().unwrap_or("export"), &[ext]));
    let one: [&str; 1] = [ext];
    let Some(p) = dialogs::save(&format!("Save {}", label.to_lowercase()), &default, &[(label, &one)]).await else {
        return Ok(None);
    };
    fs::write(&p, bytes).map_err(err)?;
    Ok(Some(p.to_string_lossy().into()))
}

#[tauri::command]
pub async fn file_open_data(kind: String) -> Res<tauri::ipc::Response> {
    let (label, exts) = data_kind(&kind).ok_or("Unknown kind of file")?;
    let Some(p) = dialogs::open_file(&format!("Open {}", label.to_lowercase()), &[(label, exts)]).await else {
        return Ok(cancelled());
    };
    if fs::metadata(&p).map(|m| m.len()).unwrap_or(0) > 300 * 1024 * 1024 {
        return Err("That file is too large".into());
    }
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    let bytes = fs::read(&p).map_err(err)?;
    Ok(packed(&json!({ "name": name }), &bytes))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedImage {
    name: String,
    data_url: String,
}

#[tauri::command]
pub async fn file_save_pngs(images: Vec<NamedImage>) -> Res<Option<String>> {
    let Some(dir) = dialogs::open_folder("Choose a folder for the exported thumbnails").await else { return Ok(None) };
    let mut used = std::collections::HashSet::new();
    for img in images {
        // Plain file names only, inside the chosen folder, with the image's real extension, never overwriting.
        let (bytes, ext) = projects::image_bytes(&img.data_url)?;
        let base = strip_ext(&safe_file_name(&img.name, "thumbnail"), &["png", "jpg", "jpeg"]);
        let base = if base.is_empty() { "thumbnail".to_string() } else { base };
        let mut name = format!("{base}.{ext}");
        while used.contains(&name.to_lowercase()) || dir.join(&name).exists() {
            let stem = &name[..name.len() - ext.len() - 1];
            name = format!("{stem}-1.{ext}");
        }
        used.insert(name.to_lowercase());
        fs::write(dir.join(&name), bytes).map_err(err)?;
    }
    Ok(Some(dir.to_string_lossy().into()))
}

// ------------------------------------------------------------------ Claude bridge and window life

#[tauri::command]
pub fn claude_response(id: u64, ok: bool, result: Option<Value>, error: Option<String>) {
    claude::respond(id, ok, result, error);
}

#[tauri::command]
pub fn claude_register_tools(tools: Vec<Value>) {
    claude::register_tools(tools);
}

/// The window has drawn its interface (see the start-up check in lib.rs).
#[tauri::command]
pub fn app_ready() {
    crate::READY.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// The window wrote its recovery copy; it may close now.
#[tauri::command]
pub fn app_flushed() {
    crate::flushed();
}

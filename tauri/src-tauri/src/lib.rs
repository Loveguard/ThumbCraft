// ThumbCraft's Tauri shell: one window running the React/Three.js interface, with everything that needs the
// computer (Minecraft files, the world generator, Java, dialogs, the Claude bridge, updates) done here in Rust.
mod anvil;
mod assets;
mod claude;
mod commands;
mod compat;
mod dialogs;
mod fonts;
mod generator;
mod java;
mod mobs;
mod mojang;
mod nbt;
mod net;
mod packs;
mod projects;
mod settings;
mod updates;
mod util;
#[cfg(test)]
mod smoke;

use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// The interface has appeared (the window says so through app_ready).
pub static READY: AtomicBool = AtomicBool::new(false);

/// The window's last recovery copy is written (or it took too long): closing may go ahead.
static FLUSHED: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

pub fn flushed() {
    *FLUSHED.0.lock().unwrap() = true;
    FLUSHED.1.notify_all();
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder().status(StatusCode::NOT_FOUND).body(Cow::Borrowed(&b"Not found"[..])).unwrap()
}

fn ok(bytes: Vec<u8>, kind: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .header("content-type", kind)
        .header("access-control-allow-origin", "*")
        .body(Cow::Owned(bytes))
        .unwrap()
}

/// "/textures/block/stone.png" → ("textures", "block/stone.png"). The window builds these addresses with
/// platform/tauri.ts (http://mcasset.localhost/… on Windows, mcasset://localhost/… elsewhere).
fn split_path(req: &Request<Vec<u8>>) -> Option<(String, String)> {
    let path = percent_encoding::percent_decode_str(req.uri().path()).decode_utf8().ok()?.to_string();
    let path = path.trim_start_matches('/');
    let (first, rest) = path.split_once('/')?;
    if rest.split('/').any(|p| p == ".." || p.is_empty()) {
        return None;
    }
    Some((first.to_string(), rest.to_string()))
}

/// Textures from the loaded client jar (with resource packs): mcasset://localhost/textures/block/stone.png
fn mcasset(req: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let Some((first, rest)) = split_path(req) else { return not_found() };
    let path = format!("{first}/{rest}");
    match assets::read_asset(&path) {
        Some(bytes) => ok(bytes.to_vec(), if path.ends_with(".png") { "image/png" } else { "application/json" }),
        None => not_found(),
    }
}

/// Bundled files: MediaPipe's background remover (tcres://localhost/mediapipe/…) and the secret scenes'
/// models (tcres://localhost/secret/…). Nothing else is reachable through it.
fn tcres(req: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let Some((group, name)) = split_path(req) else { return not_found() };
    let kind = match (group.as_str(), name.as_str()) {
        ("mediapipe", "vision_wasm_internal.js") => "text/javascript",
        ("mediapipe", "vision_wasm_internal.wasm") => "application/wasm",
        ("mediapipe", "selfie_segmenter.tflite") => "application/octet-stream",
        ("secret", "vision.glb" | "builds.glb" | "boss.glb" | "glasses.glb") => "model/gltf-binary",
        _ => return not_found(),
    };
    let mut dirs: Vec<PathBuf> = util::resource_dirs().into_iter().map(|d| d.join(&group)).collect();
    if let Some(root) = util::dev_root() {
        if group == "mediapipe" {
            dirs.push(root.join("node_modules/@mediapipe/tasks-vision/wasm"));
            dirs.push(root.join("resources/models"));
        } else {
            dirs.push(root.join("resources/secret"));
        }
    }
    match dirs.iter().map(|d| d.join(&name)).find(|p| p.exists()).and_then(|p| fs::read(p).ok()) {
        Some(bytes) => ok(bytes, kind),
        None => not_found(),
    }
}

/// Addresses the window may show: its own pages (and the dev server while running from source).
fn own_page(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => host == "tauri.localhost" || (cfg!(debug_assertions) && host == "localhost"),
        _ => false,
    }
}

fn open_externally(url: &tauri::Url) {
    if url.scheme() == "https" {
        use tauri_plugin_opener::OpenerExt;
        let _ = util::app().opener().open_url(url.as_str(), None::<&str>);
    }
}

fn create_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("ThumbCraft")
        .inner_size(1600.0, 960.0)
        .min_inner_size(1100.0, 700.0)
        .background_color(tauri::webview::Color(11, 12, 14, 255))
        // Keep rendering while covered or minimised, so Claude's screenshots and exports finish in the background.
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        // The app never navigates; a stray link or drop must not load another page next to the app's commands.
        .on_navigation(|url| {
            if own_page(url) {
                return true;
            }
            open_externally(url);
            false
        })
        .on_new_window(|url, _features| {
            open_externally(&url);
            tauri::webview::NewWindowResponse::Deny
        })
        .disable_drag_drop_handler()
        .build()?;
    // Give the window a moment to write its recovery copy before it goes away.
    let w = win.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            if *FLUSHED.0.lock().unwrap() {
                return;
            }
            api.prevent_close();
            let _ = w.emit("app:flush", ());
            let w = w.clone();
            std::thread::spawn(move || {
                let (m, cv) = &FLUSHED;
                let guard = m.lock().unwrap();
                let (mut done, _) = cv.wait_timeout_while(guard, Duration::from_millis(2500), |f| !*f).unwrap();
                *done = true;
                drop(done);
                let _ = w.close();
            });
        }
    });
    // A window that never shows anything is the worst way to fail: if the interface hasn't appeared after a
    // while, say what to do instead of leaving a silent dark window.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(20));
        if !READY.load(Ordering::SeqCst) {
            eprintln!("[ThumbCraft] The interface has not appeared after 20 seconds.");
            dialogs::warn(
                "ThumbCraft",
                "ThumbCraft is taking unusually long to start.\n\nPress Ctrl+R (Cmd+R on a Mac) to reload the window. If it stays dark, close the app and start it again; when running from source, the terminal lists the error.",
            );
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // Self-updating needs an updater key (see updates.rs); without one the app only links to new releases.
    let self_update = context
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty());

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // One window only: a second launch focuses the running app instead of fighting over the generator and files.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    builder = builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init());
    if self_update {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    let app = builder
        .register_asynchronous_uri_scheme_protocol("mcasset", |_ctx, req, responder| {
            std::thread::spawn(move || responder.respond(mcasset(&req)));
        })
        .register_asynchronous_uri_scheme_protocol("tcres", |_ctx, req, responder| {
            std::thread::spawn(move || responder.respond(tcres(&req)));
        })
        .invoke_handler(tauri::generate_handler![
            commands::mc_load_newest,
            commands::mc_pick_jar,
            commands::mc_pick_world,
            commands::mc_load_jar,
            commands::mc_find_java,
            commands::java_install,
            commands::mc_download_client,
            commands::mc_eula_accepted,
            commands::mc_accept_eula,
            commands::skin_fetch,
            commands::terrain_generate,
            commands::terrain_cancel,
            commands::terrain_prefetch,
            commands::terrain_prewarm,
            commands::terrain_import,
            commands::structure_load,
            commands::schematic_import,
            commands::mobs_mappings,
            commands::mobs_load,
            commands::packs_list,
            commands::packs_add,
            commands::packs_set,
            commands::fonts_list,
            commands::fonts_read,
            commands::file_save_png,
            commands::file_save_psd,
            commands::file_choose_video,
            commands::file_write_video,
            commands::file_save_data,
            commands::file_open_data,
            commands::file_save_pngs,
            commands::claude_response,
            commands::claude_register_tools,
            commands::app_ready,
            commands::app_flushed,
            projects::project_save,
            projects::project_autosave,
            projects::project_open,
            projects::project_recent,
            projects::project_open_recent,
            projects::project_forget,
        ])
        .setup(move |app| {
            util::set_app(app.handle().clone());
            create_window(app.handle())?;
            updates::check(app.handle().clone(), self_update);
            claude::start();
            Ok(())
        })
        .build(context)
        .expect("error while starting ThumbCraft");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            claude::stop();
            mobs::stop_export();
            generator::shutdown(true);
            updates::install_on_quit();
        }
    });
}

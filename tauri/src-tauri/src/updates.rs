// Keeping ThumbCraft up to date from its GitHub releases. With an updater key set up (tauri.conf.json
// plugins.updater.pubkey, and releases built with createUpdaterArtifacts), installed copies download a new
// version in the background and install it when the app quits, on Windows and macOS. Without a key, the app
// just tells the user a new version is out and links to the download page (like the Electron build's macOS and
// portable versions).
use serde_json::json;
use std::sync::Mutex;

use crate::compat::compare_versions;
use crate::net::get_json;
use crate::util::emit;

pub const RELEASES_REPO: &str = "Loveguard/ThumbCraft";

/// True when a > b for dotted versions like 0.2.10 vs 0.2.9 (a leading "v" is ignored).
pub fn newer_version(a: &str, b: &str) -> bool {
    compare_versions(a.trim_start_matches('v'), b.trim_start_matches('v')) == std::cmp::Ordering::Greater
}

/// A downloaded update waiting for the app to quit.
static READY: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = Mutex::new(None);

pub fn check(app: tauri::AppHandle, self_update: bool) {
    if cfg!(debug_assertions) {
        return; // running from source
    }
    tauri::async_runtime::spawn(async move {
        if self_update {
            use tauri_plugin_updater::UpdaterExt;
            let Ok(updater) = app.updater() else { return };
            // Offline is fine.
            let Ok(Some(update)) = updater.check().await else { return };
            let Ok(bytes) = update.download(|_, _| {}, || {}).await else { return };
            emit("app:update", json!({ "version": update.version, "ready": true, "url": "" }));
            *READY.lock().unwrap() = Some((update, bytes));
            return;
        }
        let latest = tauri::async_runtime::spawn_blocking(|| {
            get_json(&format!("https://api.github.com/repos/{RELEASES_REPO}/releases/latest"))
        })
        .await;
        let Ok(Ok(latest)) = latest else { return };
        let tag = latest["tag_name"].as_str().unwrap_or("");
        if !tag.is_empty() && newer_version(tag, env!("CARGO_PKG_VERSION")) {
            emit(
                "app:update",
                json!({ "version": tag.trim_start_matches('v'), "ready": false, "url": latest["html_url"] }),
            );
        }
    });
}

/// Installs a downloaded update as the app quits (the installer replaces the app files).
pub fn install_on_quit() {
    if let Some((update, bytes)) = READY.lock().unwrap().take() {
        let _ = update.install(bytes);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert!(super::newer_version("v0.5.1", "0.5.0"));
        assert!(!super::newer_version("v0.5.0", "0.5.0"));
        assert!(super::newer_version("0.10.0", "0.9.9"));
    }
}

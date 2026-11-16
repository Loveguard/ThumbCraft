// Native open/save dialogs, shown over the main window. Every path they return is remembered as picked.
use std::path::PathBuf;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

use crate::util::{add_picked, app};

pub type Filter<'a> = (&'a str, &'a [&'a str]);

fn builder(title: &str, filters: &[Filter]) -> FileDialogBuilder<tauri::Wry> {
    let mut b = app().dialog().file().set_title(title);
    if let Some(w) = app().get_webview_window("main") {
        b = b.set_parent(&w);
    }
    for (name, exts) in filters {
        b = b.add_filter(*name, exts);
    }
    b
}

fn to_path(p: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    p.into_path().ok()
}

/// Runs a blocking dialog off the async runtime's threads.
async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(f).await.expect("dialog thread")
}

pub async fn save(title: &str, default_name: &str, filters: &[Filter<'_>]) -> Option<PathBuf> {
    let b = builder(title, filters).set_file_name(default_name);
    let p = off_thread(move || b.blocking_save_file()).await.and_then(to_path)?;
    add_picked(&p);
    Some(p)
}

pub async fn open_file(title: &str, filters: &[Filter<'_>]) -> Option<PathBuf> {
    let b = builder(title, filters);
    let p = off_thread(move || b.blocking_pick_file()).await.and_then(to_path)?;
    add_picked(&p);
    Some(p)
}

pub async fn open_files(title: &str, filters: &[Filter<'_>]) -> Vec<PathBuf> {
    let b = builder(title, filters);
    let list = off_thread(move || b.blocking_pick_files()).await.unwrap_or_default();
    let out: Vec<PathBuf> = list.into_iter().filter_map(to_path).collect();
    out.iter().for_each(|p| add_picked(p));
    out
}

pub async fn open_folder(title: &str) -> Option<PathBuf> {
    let b = builder(title, &[]);
    let p = off_thread(move || b.blocking_pick_folder()).await.and_then(to_path)?;
    add_picked(&p);
    Some(p)
}

/// A warning box over the main window (used when the interface fails to appear).
pub fn warn(title: &str, message: &str) {
    use tauri_plugin_dialog::{MessageDialogBuilder, MessageDialogKind};
    let mut b: MessageDialogBuilder<tauri::Wry> =
        app().dialog().message(message).title(title).kind(MessageDialogKind::Warning);
    if let Some(w) = app().get_webview_window("main") {
        b = b.parent(&w);
    }
    b.show(|_| {});
}

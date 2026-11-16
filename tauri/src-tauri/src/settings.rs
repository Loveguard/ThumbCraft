// settings.json in the data folder (same file and keys as the Electron build).
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::util::{user_data, write_atomic};

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> PathBuf {
    user_data().join("settings.json")
}

pub fn read() -> Map<String, Value> {
    fs::read_to_string(file())
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

pub fn get(key: &str) -> Option<Value> {
    read().get(key).cloned()
}

pub fn get_str(key: &str) -> Option<String> {
    get(key).and_then(|v| v.as_str().map(str::to_string))
}

pub fn eula_accepted() -> bool {
    get("eulaAccepted") == Some(Value::Bool(true))
}

/// Atomic, so a crash mid-write can't reset the EULA tick and the generator's default world.
pub fn update(patch: Map<String, Value>) {
    let _guard = LOCK.lock().unwrap();
    let mut all = read();
    for (k, v) in patch {
        all.insert(k, v);
    }
    let bytes = serde_json::to_vec_pretty(&Value::Object(all)).unwrap_or_default();
    let _ = write_atomic(&file(), &bytes);
}

pub fn set(key: &str, value: Value) {
    let mut m = Map::new();
    m.insert(key.to_string(), value);
    update(m);
}

// Exports the game's own mob models by running tools/model-dumper against the user's client jar
// (port of main/mobs.ts). For obfuscated versions the window turns Mojang's mappings into the dumper's name
// list (shared/minecraft/entityModels.ts namesFromMappings) and passes it back in.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::assets::{current_jar, current_version, entity_texture_sizes, is_obfuscated, version_json_path};
use crate::java::find_java;
use crate::net::{get_bytes, sha1_hex};
use crate::util::{cache_dir, command, dev_root, err, resource_dirs, Res};

fn os_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn allowed(lib: &Value) -> bool {
    let Some(rules) = lib["rules"].as_array() else { return true };
    let mut ok = false;
    for r in rules {
        let os = r["os"]["name"].as_str();
        if os.is_none() || os == Some(os_name()) {
            ok = r["action"] == "allow";
        }
    }
    ok
}

/// Maven coordinate → relative path, for libraries without an explicit download path.
fn maven_path(name: &str) -> String {
    let p: Vec<&str> = name.split(':').collect();
    let (group, artifact, version) = (p.first().unwrap_or(&""), p.get(1).unwrap_or(&""), p.get(2).unwrap_or(&""));
    let classifier = p.get(3).map(|c| format!("-{c}")).unwrap_or_default();
    format!("{}/{artifact}/{version}/{artifact}-{version}{classifier}.jar", group.replace('.', "/"))
}

/// A library's file inside <root>/libraries; refuses paths that would leave that folder.
fn library_file(root: &Path, path: &str) -> Res<PathBuf> {
    let rel = Path::new(path);
    let bad = rel.is_absolute()
        || path.is_empty()
        || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_)));
    if bad {
        return Err(format!("Unsafe library path: {path}"));
    }
    Ok(root.join("libraries").join(rel))
}

struct VersionInfo {
    json: Value,
    root: PathBuf,
    libraries: Vec<Value>,
}

fn read_version(id: &str, jar: &Path, depth: u32) -> Res<VersionInfo> {
    let file = version_json_path(id, Some(jar)).ok_or_else(|| {
        format!("Couldn't find {id}.json next to the jar. Load a version from the official launcher folder.")
    })?;
    // Launcher layout: <root>/versions/<id>/<id>.json
    let root = file.parent().and_then(Path::parent).and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default();
    let mut json: Value = serde_json::from_slice(&fs::read(&file).map_err(err)?).map_err(err)?;
    let mut libraries = json["libraries"].as_array().cloned().unwrap_or_default();
    if let Some(parent) = json["inheritsFrom"].as_str().map(str::to_string) {
        if depth > 4 {
            return Err("Too many nested version profiles".into());
        }
        let p = read_version(&parent, &root.join("versions").join(&parent).join(format!("{parent}.jar")), depth + 1)?;
        libraries.extend(p.libraries);
        if json["javaVersion"].is_null() {
            json["javaVersion"] = p.json["javaVersion"].clone();
        }
        if json["downloads"].is_null() {
            json["downloads"] = p.json["downloads"].clone();
        }
    }
    Ok(VersionInfo { json, root, libraries })
}

/// Its own package: Mojang's signed jar puts obfuscated classes in the unnamed package.
const DUMPER_MAIN: &str = "dev.blockframe.dumper.ModelDumper";

/// Folder holding dev/blockframe/dumper/ModelDumper.class.
fn dumper_dir() -> Res<PathBuf> {
    let mut candidates: Vec<PathBuf> = resource_dirs().into_iter().map(|d| d.join("model-dumper")).collect();
    if let Some(root) = dev_root() {
        candidates.push(root.join("resources"));
    }
    candidates
        .into_iter()
        .find(|d| d.join("dev/blockframe/dumper/ModelDumper.class").exists())
        .ok_or_else(|| "ModelDumper.class is missing; run \"npm run build:dumper\" in the main folder".into())
}

fn cached_file(version: &str) -> PathBuf {
    cache_dir(&["mobs", &format!("{version}.json")])
}

fn result(version: &str, text: &str) -> Res<Value> {
    let parsed: Value = serde_json::from_str(text).map_err(err)?;
    Ok(json!({ "version": version, "layers": parsed["layers"], "textureSizes": entity_texture_sizes() }))
}

/// Mojang's mappings for the loaded version when the model export needs them (obfuscated versions not yet
/// exported); None when it doesn't.
pub fn mappings_needed() -> Res<Option<String>> {
    let version = current_version();
    if cached_file(&version).exists() || !is_obfuscated() {
        return Ok(None);
    }
    let file = cache_dir(&["mappings", &format!("{version}.txt")]);
    if let Ok(t) = fs::read_to_string(&file) {
        return Ok(Some(t));
    }
    let info = read_version(&version, Path::new(&current_jar()), 0)?;
    let dl = &info.json["downloads"]["client_mappings"];
    let url = dl["url"].as_str().ok_or_else(|| format!("Minecraft {version} is obfuscated and Mojang publishes no mappings for it"))?;
    let bytes = get_bytes(url, |_, _| {})?;
    if let Some(want) = dl["sha1"].as_str() {
        if sha1_hex(&bytes) != want {
            return Err("Mojang's mappings download was corrupted; try again".into());
        }
    }
    let text = String::from_utf8_lossy(&bytes).to_string();
    fs::create_dir_all(file.parent().unwrap()).map_err(err)?;
    fs::write(&file, &text).map_err(err)?;
    Ok(Some(text))
}

/// The model exporters while they run, so quitting the app stops them too.
static EXPORTERS: LazyLock<Mutex<Vec<Arc<Mutex<Child>>>>> = LazyLock::new(Mutex::default);

/// Kills any running model export (on quit).
pub fn stop_export() {
    for c in EXPORTERS.lock().unwrap().iter() {
        let _ = c.lock().unwrap().kill();
    }
}

fn run(java: &Path, args: &[&str], cwd: &Path, log: &(dyn Fn(&str) + Sync)) -> Res<()> {
    let mut child = command(java, false)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(err)?;
    let (mut out, mut errs) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let child = Arc::new(Mutex::new(child));
    EXPORTERS.lock().unwrap().push(child.clone());
    let all = Arc::new(Mutex::new(String::new()));
    let err_text = Arc::new(Mutex::new(String::new()));
    let (tx, rx) = std::sync::mpsc::channel::<(bool, String)>();
    let tx2 = tx.clone();
    let t1 = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = out.read(&mut buf) {
            if n == 0 {
                break;
            }
            let _ = tx.send((false, String::from_utf8_lossy(&buf[..n]).into()));
        }
    });
    let t2 = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = errs.read(&mut buf) {
            if n == 0 {
                break;
            }
            let _ = tx2.send((true, String::from_utf8_lossy(&buf[..n]).into()));
        }
    });
    let start = Instant::now();
    let mut timed_out = false;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok((is_err, text)) => {
                all.lock().unwrap().push_str(&text);
                if is_err {
                    err_text.lock().unwrap().push_str(&text);
                }
                log(&text);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(_) => {}
        }
        if start.elapsed() > Duration::from_secs(180) && !timed_out {
            timed_out = true;
            let _ = child.lock().unwrap().kill();
        }
    }
    let _ = (t1.join(), t2.join());
    let status = child.lock().unwrap().wait().map_err(err)?;
    EXPORTERS.lock().unwrap().retain(|c| !Arc::ptr_eq(c, &child));
    let log_file = cwd.join("dumper.log");
    let _ = fs::write(&log_file, all.lock().unwrap().as_bytes());
    if timed_out {
        return Err("Exporting mob models timed out".into());
    }
    if status.success() {
        return Ok(());
    }
    // Prefer the dumper's own ERROR/Caused by lines; otherwise the last lines Java printed.
    let e = err_text.lock().unwrap().clone();
    let lines: Vec<&str> = e.trim().lines().collect();
    let key: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| ["ERROR", "Caused by", "Error", "Exception"].iter().any(|p| l.trim().starts_with(p)))
        .collect();
    let pick = if key.is_empty() { lines[lines.len().saturating_sub(4)..].to_vec() } else { key };
    let summary: Vec<&str> = pick.into_iter().take(4).collect();
    let code = status.code().map(|c| c.to_string()).unwrap_or_else(|| "killed".into());
    Err(format!(
        "Mob model export failed (exit {code}).\n{}\nFull log: {}",
        summary.join("\n"),
        log_file.to_string_lossy()
    ))
}

/// Exports in progress, per version (a second request waits for the first instead of starting another).
static INFLIGHT: LazyLock<Mutex<HashMap<String, Arc<(Mutex<Option<Res<String>>>, Condvar)>>>> =
    LazyLock::new(Mutex::default);

/// Mob models for the loaded version; exported once, then cached on disk.
pub fn load(names: Option<String>, log: &(dyn Fn(&str) + Sync)) -> Res<Value> {
    let version = current_version();
    let cached = cached_file(&version);
    if let Ok(text) = fs::read_to_string(&cached) {
        return result(&version, &text);
    }
    let (slot, mine) = {
        let mut map = INFLIGHT.lock().unwrap();
        match map.get(&version) {
            Some(s) => (s.clone(), false),
            None => {
                let s: Arc<(Mutex<Option<Res<String>>>, Condvar)> = Arc::default();
                map.insert(version.clone(), s.clone());
                (s, true)
            }
        }
    };
    if !mine {
        let (m, cv) = &*slot;
        let mut r = m.lock().unwrap();
        while r.is_none() {
            r = cv.wait(r).unwrap();
        }
        return result(&version, r.as_ref().unwrap().as_ref().map_err(Clone::clone)?);
    }
    let outcome = export(&version, names, log);
    INFLIGHT.lock().unwrap().remove(&version);
    let (m, cv) = &*slot;
    *m.lock().unwrap() = Some(outcome.clone());
    cv.notify_all();
    result(&version, &outcome?)
}

fn export(version: &str, names: Option<String>, log: &(dyn Fn(&str) + Sync)) -> Res<String> {
    let jar = PathBuf::from(current_jar());
    let info = read_version(version, &jar, 0)?;
    // The model reader is compiled for Java 17, whatever the game version needs.
    let need = (info.json["javaVersion"]["majorVersion"].as_u64().unwrap_or(17) as u32).max(17);
    let java = find_java(need).ok_or_else(|| format!("Java {need}+ is required to read mob models"))?;
    let work = cache_dir(&["mobs", &format!("{version}-work")]);
    fs::create_dir_all(&work).map_err(err)?;
    let names = if is_obfuscated() {
        names.ok_or("The mob name list is missing; try again")?
    } else {
        String::new()
    };
    fs::write(work.join("names.properties"), names).map_err(err)?;

    // Modern versions list LWJGL natives as ordinary classpath jars; only the legacy "natives" style is skipped.
    let wanted: Vec<&Value> = info.libraries.iter().filter(|l| allowed(l) && l["natives"].is_null()).collect();
    let lib_path = |l: &Value| -> String {
        l["downloads"]["artifact"]["path"].as_str().map(str::to_string).unwrap_or_else(|| maven_path(l["name"].as_str().unwrap_or("")))
    };
    // Versions downloaded by ThumbCraft (or copied without the launcher) lack their libraries: fetch them.
    let missing: Vec<&&Value> = wanted
        .iter()
        .filter(|l| {
            l["downloads"]["artifact"]["url"].is_string()
                && library_file(&info.root, &lib_path(l)).map(|p| !p.exists()).unwrap_or(false)
        })
        .collect();
    for (i, l) in missing.iter().enumerate() {
        let a = &l["downloads"]["artifact"];
        let (url, sha) = (a["url"].as_str().unwrap_or(""), a["sha1"].as_str());
        let name = l["name"].as_str().unwrap_or("A library");
        // A version file from a third-party launcher could point anywhere: only hash-checked HTTPS downloads.
        let Some(sha) = sha.filter(|_| url.starts_with("https://")) else {
            return Err(format!("{name} has no verifiable download"));
        };
        log(&format!("Downloading game libraries from Mojang ({} of {})…", i + 1, missing.len()));
        let bytes = get_bytes(url, |_, _| {})?;
        if sha1_hex(&bytes) != sha {
            return Err(format!("{name} was corrupted while downloading; try again"));
        }
        let file = library_file(&info.root, &lib_path(l))?;
        fs::create_dir_all(file.parent().unwrap()).map_err(err)?;
        fs::write(&file, bytes).map_err(err)?;
    }
    let mut cp = vec![dumper_dir()?, jar.clone()];
    for l in &wanted {
        if let Ok(p) = library_file(&info.root, &lib_path(l)) {
            if p.exists() {
                cp.push(p);
            }
        }
    }
    // An argument file keeps long classpaths clear of Windows' command-line limit. Java reads it in the system
    // code page, so paths are made relative to the work folder where possible (a user name like "José" in the
    // absolute path would otherwise break the classpath).
    let cp: Vec<String> = cp.iter().map(|p| relative_to(&work, p).replace('\\', "/")).collect();
    let sep = if cfg!(windows) { ";" } else { ":" };
    fs::write(
        work.join("args.txt"),
        format!("-Djava.awt.headless=true\n-cp\n\"{}\"\n{DUMPER_MAIN}\nnames.properties\nmodels.json\n", cp.join(sep)),
    )
    .map_err(err)?;
    log(&format!("Exporting mob models from Minecraft {version} (Java {})…", java.major));
    run(Path::new(&java.path), &["@args.txt"], &work, log)?;
    let out = fs::read_to_string(work.join("models.json")).map_err(err)?;
    fs::write(cached_file(version), &out).map_err(err)?;
    Ok(out)
}

/// `p` relative to `base` when they share a drive/root, otherwise `p` itself.
fn relative_to(base: &Path, p: &Path) -> String {
    let (b, t): (Vec<_>, Vec<_>) = (base.components().collect(), p.components().collect());
    if b.first() != t.first() {
        return p.to_string_lossy().into();
    }
    let common = b.iter().zip(&t).take_while(|(x, y)| x == y).count();
    let mut out = PathBuf::new();
    for _ in common..b.len() {
        out.push("..");
    }
    for c in &t[common..] {
        out.push(c);
    }
    out.to_string_lossy().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths() {
        assert_eq!(maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows"), "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar");
        assert!(library_file(Path::new("/r"), "../x.jar").is_err());
        assert_eq!(relative_to(Path::new("/a/b/work"), Path::new("/a/c/lib.jar")), "../../c/lib.jar");
    }
}

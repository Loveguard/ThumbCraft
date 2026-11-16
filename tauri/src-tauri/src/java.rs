// Finding a Java runtime for the world generator and the mob model exporter, and installing one for users
// who have none (or one too old): Eclipse Temurin from the Adoptium API, checked against its published SHA-256
// and unpacked into the app's own data folder. Nothing system-wide is changed.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::assets::{current_jar, launcher_java_candidates, version_json_path};
use crate::net::{get_bytes, get_json, megabytes};
use crate::util::{cache_dir, command, err, Res};

#[derive(Clone, Serialize)]
pub struct Java {
    pub path: String,
    pub version: String,
    pub major: u32,
}

fn parse_java_version(path: &Path, text: &str) -> Option<Java> {
    let re = regex::Regex::new(r#"version "([^"]+)""#).unwrap();
    let v = re.captures(text)?[1].to_string();
    let parts: Vec<u32> = v.split(['.', '_', '-']).map(|p| p.parse().unwrap_or(0)).collect();
    let major = if parts.first() == Some(&1) { *parts.get(1).unwrap_or(&0) } else { *parts.first()? };
    Some(Java { path: path.to_string_lossy().into(), version: v, major })
}

/// `java -version` (it writes to stderr), with a 10 second limit.
fn probe(path: PathBuf) -> Option<Java> {
    let mut child = command(&path, false)
        .arg("-version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;
    let (mut out, mut errs) = (child.stdout.take()?, child.stderr.take()?);
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = errs.read_to_string(&mut s);
        let mut o = String::new();
        let _ = out.read_to_string(&mut o);
        s + "\n" + &o
    });
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(10) => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    parse_java_version(&path, &reader.join().ok()?)
}

/// `java` from PATH, looked up by hand: spawning a bare "java" on Windows would also try the current folder
/// first, so a java.exe dropped next to the app could be run.
fn java_on_path() -> Vec<PathBuf> {
    let exe = if cfg!(windows) { "java.exe" } else { "java" };
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .filter(|d| d.is_absolute())
        .map(|d| d.join(exe))
        .filter(|p| p.exists())
        .take(1)
        .collect()
}

static JAVAS: Mutex<Option<Vec<Java>>> = Mutex::new(None);

/// Forget the probed runtimes (after installing one).
pub fn rescan() {
    *JAVAS.lock().unwrap() = None;
}

/// The newest Java at least `min_major`. Runtimes are probed once per app run, in parallel.
pub fn find_java(min_major: u32) -> Option<Java> {
    let mut guard = JAVAS.lock().unwrap();
    if guard.is_none() {
        let mut candidates = launcher_java_candidates();
        candidates.extend(java_on_path());
        let handles: Vec<_> = candidates.into_iter().map(|p| std::thread::spawn(move || probe(p))).collect();
        let mut all: Vec<Java> = handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect();
        all.sort_by(|a, b| b.major.cmp(&a.major));
        *guard = Some(all);
    }
    guard.as_ref().unwrap().iter().find(|j| j.major >= min_major).cloned()
}

/// The Java the loaded Minecraft version needs (its version json says; 17 is the floor for our tools).
pub fn required_java(version: &str) -> u32 {
    let jar = current_jar();
    let file = version_json_path(version, (!jar.is_empty()).then(|| Path::new(&jar)));
    let need = file
        .and_then(|f| fs::read(f).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["javaVersion"]["majorVersion"].as_u64())
        .unwrap_or(21) as u32;
    need.max(17)
}

/// What the Biomes tab shows: the Java found and whether it is new enough.
pub fn java_info(version: &str) -> Option<Value> {
    let need = required_java(version);
    let j = find_java(need).or_else(|| find_java(0))?;
    Some(serde_json::json!({ "path": j.path, "version": j.version, "enough": j.major >= need, "need": need }))
}

/// Long-term-support releases, smallest first: the lowest one that's new enough is installed.
const LTS: [u32; 3] = [17, 21, 25];

/// A relative path inside an archive, or None when it would leave the folder.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let norm = path.replace('\\', "/");
    if norm.starts_with('/') || (norm.len() > 1 && norm.as_bytes()[1] == b':') {
        return None;
    }
    let parts: Vec<&str> = norm.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
    if parts.contains(&"..") || parts.is_empty() {
        return None;
    }
    Some(parts.iter().collect())
}

/// Whether a relative path (which may contain "..") still points inside its folder once resolved.
fn stays_inside(p: &Path) -> bool {
    let mut depth = 0i32;
    for c in p.components() {
        match c {
            std::path::Component::Normal(_) => depth += 1,
            std::path::Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            std::path::Component::CurDir => {}
            _ => return false,
        }
    }
    true
}

pub fn install_java(min_major: u32, log: &dyn Fn(&str)) -> Res<()> {
    let major = LTS.iter().copied().find(|v| *v >= min_major).unwrap_or(min_major);
    let os = if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "mac" } else { "linux" };
    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
    log(&format!("Looking up Java {major} for {os} ({arch})…"));
    let assets = get_json(&format!(
        "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jre&os={os}&vendor=eclipse"
    ))
    .map_err(|e| format!("Couldn't reach Adoptium to download Java ({e})"))?;
    let asset = &assets[0];
    let pkg = &asset["binary"]["package"];
    let (Some(link), Some(checksum), Some(name)) = (pkg["link"].as_str(), pkg["checksum"].as_str(), pkg["name"].as_str())
    else {
        return Err(format!("Adoptium has no Java {major} runtime for this computer"));
    };
    let release = asset["release_name"].as_str().unwrap_or("").to_string();
    let size = pkg["size"].as_u64().unwrap_or(0);
    let bytes = get_bytes(link, |done, total| {
        log(&format!(
            "Downloading Java {major} ({release})… {} of {}",
            megabytes(done),
            megabytes(if total > 0 { total } else { size })
        ))
    })?;
    if hex::encode(Sha256::digest(&bytes)) != checksum.to_lowercase() {
        return Err("The Java download was corrupted (checksum mismatch); try again".into());
    }
    log(&format!("Unpacking Java {major}…"));
    let dest = cache_dir(&["java", &major.to_string()]);
    let tmp = cache_dir(&["java", &format!("{major}.partial")]);
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(err)?;
    if name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
        for i in 0..zip.len() {
            let mut e = zip.by_index(i).map_err(err)?;
            if e.is_dir() {
                continue;
            }
            let Some(rel) = safe_relative(e.name()) else { continue };
            let p = tmp.join(rel);
            fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
            let mut out = fs::File::create(&p).map_err(err)?;
            std::io::copy(&mut e, &mut out).map_err(err)?;
            #[cfg(unix)]
            if let Some(mode) = e.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&p, fs::Permissions::from_mode(mode & 0o777));
            }
        }
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(std::io::Cursor::new(bytes)));
        for entry in archive.entries().map_err(err)? {
            let mut e = entry.map_err(err)?;
            let raw = e.path().map_err(err)?.to_string_lossy().to_string();
            let Some(rel) = safe_relative(&raw) else { continue };
            let p = tmp.join(&rel);
            let kind = e.header().entry_type();
            if kind.is_dir() {
                fs::create_dir_all(&p).map_err(err)?;
            } else if kind.is_symlink() {
                // Only relative links that stay inside the runtime (macOS bundles link libjli this way).
                let link = e.link_name().map_err(err)?.ok_or("Unsafe link in the Java archive")?;
                let link = link.to_string_lossy().to_string();
                let joined = rel.parent().map(|d| d.join(&link)).unwrap_or_else(|| PathBuf::from(&link));
                if Path::new(&link).is_absolute() || !stays_inside(&joined) {
                    return Err("Unsafe link in the Java archive".into());
                }
                fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
                let _ = fs::remove_file(&p);
                #[cfg(unix)]
                std::os::unix::fs::symlink(&link, &p).map_err(err)?;
            } else if kind.is_file() {
                fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
                let mut out = fs::File::create(&p).map_err(err)?;
                std::io::copy(&mut e, &mut out).map_err(err)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mode = e.header().mode().unwrap_or(0o644) & 0o777;
                    let _ = fs::set_permissions(&p, fs::Permissions::from_mode(if mode == 0 { 0o644 } else { mode }));
                }
            }
        }
    }
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&tmp, &dest).map_err(err)?;
    if !dest.exists() {
        return Err("Java could not be installed".into());
    }
    log(&format!("Java {major} is ready"));
    Ok(())
}

// Mojang's public endpoints: player profiles/skins and official game downloads.
use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::net::{get, get_bytes, get_json, megabytes, sha1_hex};
use crate::util::{err, Res};

const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

pub fn fetch_skin(username: &str) -> Res<Value> {
    let name = username.trim();
    let valid = (1..=16).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err("Minecraft usernames are 1–16 letters, digits or underscores".into());
    }
    let profile = get(&format!("https://api.mojang.com/users/profiles/minecraft/{name}"), None)
        .map_err(|e| format!("Mojang profile lookup failed ({e})"))?
        .ok_or_else(|| format!("No Minecraft account named \"{name}\""))?;
    let profile: Value = profile.into_json().map_err(err)?;
    let id = profile["id"].as_str().ok_or("Mojang sent an unreadable profile")?.to_string();
    let pname = profile["name"].as_str().unwrap_or(name).to_string();
    let session = get_json(&format!("https://sessionserver.mojang.com/session/minecraft/profile/{id}"))?;
    let prop = session["properties"]
        .as_array()
        .and_then(|a| a.iter().find(|p| p["name"] == "textures"))
        .and_then(|p| p["value"].as_str())
        .ok_or("Profile has no textures")?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(prop).map_err(err)?;
    let textures: Value = serde_json::from_slice(&decoded).map_err(err)?;
    let skin = &textures["textures"]["SKIN"];
    let Some(skin_url) = skin["url"].as_str() else {
        return Err(format!("{pname} uses a default skin"));
    };
    let https = |u: &str| u.replacen("http:", "https:", 1);
    let skin_png = get_bytes(&https(skin_url), |_, _| {})?;
    let cape = match textures["textures"]["CAPE"]["url"].as_str() {
        Some(u) => Some(data_url(&get_bytes(&https(u), |_, _| {})?)),
        None => None,
    };
    Ok(json!({
        "username": pname,
        "uuid": id,
        "model": if skin["metadata"]["model"] == "slim" { "slim" } else { "classic" },
        "skinDataUrl": data_url(&skin_png),
        "capeDataUrl": cape
    }))
}

pub fn version_json(version_id: &str) -> Res<Value> {
    let manifest = get_json(MANIFEST)?;
    let url = manifest["versions"]
        .as_array()
        .and_then(|a| a.iter().find(|v| v["id"] == version_id))
        .and_then(|v| v["url"].as_str())
        .ok_or_else(|| {
            format!("Mojang has no download for version \"{version_id}\" (modded or custom versions need a vanilla id)")
        })?
        .to_string();
    get_json(&url)
}

/// Downloads (once) and verifies the official dedicated server jar for a version. Works offline once
/// downloaded: the version json is kept beside the jar and the jar re-verified against it.
pub fn ensure_server_jar(version_id: &str, dest: &Path, log: &dyn Fn(&str)) -> Res<Value> {
    let saved = PathBuf::from(format!("{}.version.json", dest.to_string_lossy()));
    if dest.exists() && saved.exists() {
        if let Some(vj) = fs::read(&saved).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
            if let Some(want) = vj["downloads"]["server"]["sha1"].as_str() {
                if fs::read(dest).map(|b| sha1_hex(&b) == want).unwrap_or(false) {
                    return Ok(vj);
                }
            }
        }
    }
    let vj = version_json(version_id)?;
    let dl = &vj["downloads"]["server"];
    let (Some(url), Some(sha)) = (dl["url"].as_str(), dl["sha1"].as_str()) else {
        return Err(format!("Version {version_id} has no official server download"));
    };
    let keep = |vj: &Value| -> Res<()> { fs::write(&saved, serde_json::to_vec(vj).map_err(err)?).map_err(err) };
    if dest.exists() && fs::read(dest).map(|b| sha1_hex(&b) == sha).unwrap_or(false) {
        keep(&vj)?;
        return Ok(vj);
    }
    log(&format!("Downloading official Minecraft {version_id} server from Mojang…"));
    let bytes = get_bytes(url, |_, _| {})?;
    if sha1_hex(&bytes) != sha {
        return Err("Server jar checksum mismatch".into());
    }
    if let Some(d) = dest.parent() {
        fs::create_dir_all(d).map_err(err)?;
    }
    fs::write(dest, bytes).map_err(err)?;
    keep(&vj)?;
    Ok(vj)
}

/// Downloads (once) the latest official client jar and its version json from Mojang, laid out like a launcher
/// folder (clients/versions/<id>/<id>.jar) so everything else finds it. Returns the jar path.
pub fn download_latest_client(clients_root: &Path, log: &dyn Fn(&str)) -> Res<PathBuf> {
    let manifest = get_json(MANIFEST)?;
    let version_id = manifest["latest"]["release"].as_str().unwrap_or("").to_string();
    let ok = (1..=64).contains(&version_id.len())
        && version_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if !ok {
        return Err("Mojang listed an invalid version".into());
    }
    let vj = version_json(&version_id)?;
    let dl = &vj["downloads"]["client"];
    let (Some(url), Some(sha)) = (dl["url"].as_str(), dl["sha1"].as_str()) else {
        return Err(format!("Mojang has no client download for {version_id}"));
    };
    let dir = clients_root.join("versions").join(&version_id);
    let jar = dir.join(format!("{version_id}.jar"));
    fs::create_dir_all(&dir).map_err(err)?;
    fs::write(dir.join(format!("{version_id}.json")), serde_json::to_vec(&vj).map_err(err)?).map_err(err)?;
    if jar.exists() && fs::read(&jar).map(|b| sha1_hex(&b) == sha).unwrap_or(false) {
        return Ok(jar);
    }
    let bytes = get_bytes(url, |done, total| {
        let of = if total > 0 { format!(" of {}", megabytes(total)) } else { String::new() };
        log(&format!("Downloading Minecraft {version_id} from Mojang… {}{of}", megabytes(done)));
    })?;
    if sha1_hex(&bytes) != sha {
        return Err("The download was corrupted (checksum mismatch); try again".into());
    }
    fs::write(&jar, bytes).map_err(err)?;
    Ok(jar)
}

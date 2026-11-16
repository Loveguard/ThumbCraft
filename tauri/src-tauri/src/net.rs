// Downloads (Mojang, Adoptium, GitHub), with a size cap and optional progress.
use sha1::{Digest, Sha1};
use std::io::Read;
use std::sync::LazyLock;
use std::time::Duration;

use crate::util::Res;

static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .user_agent(concat!("ThumbCraft/", env!("CARGO_PKG_VERSION")))
        .build()
});

/// Nothing the app downloads (game jars, Java, libraries) comes near this; a larger response is cut off.
const MAX_DOWNLOAD: u64 = 1024 * 1024 * 1024;

/// A GET; `Ok(None)` for 204/404 (the caller decides what "nothing there" means).
pub fn get(url: &str, accept: Option<&str>) -> Res<Option<ureq::Response>> {
    let mut req = AGENT.get(url);
    if let Some(a) = accept {
        req = req.set("accept", a);
    }
    match req.call() {
        Ok(r) if r.status() == 204 => Ok(None),
        Ok(r) => Ok(Some(r)),
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(code, _)) => Err(format!("{url} → HTTP {code}")),
        Err(e) => Err(format!("Couldn't reach {}: {e}", host(url))),
    }
}

fn host(url: &str) -> &str {
    url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or(url)
}

pub fn get_json(url: &str) -> Res<serde_json::Value> {
    let r = get(url, Some("application/json"))?.ok_or_else(|| format!("{url} → HTTP 404"))?;
    r.into_json().map_err(|e| format!("{url} sent something unreadable ({e})"))
}

/// Downloads a file, reporting (done, total) bytes every half megabyte.
pub fn get_bytes(url: &str, mut report: impl FnMut(u64, u64)) -> Res<Vec<u8>> {
    let r = get(url, None)?.ok_or_else(|| format!("{url} → HTTP 404"))?;
    let total: u64 = r.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut reader = r.into_reader().take(MAX_DOWNLOAD + 1);
    let mut out = Vec::with_capacity(total.min(MAX_DOWNLOAD) as usize);
    let mut buf = vec![0u8; 64 * 1024];
    let mut last = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("The download from {} stopped: {e}", host(url)))?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        let done = out.len() as u64;
        if done > MAX_DOWNLOAD {
            return Err(format!("{url} is unexpectedly large; download stopped"));
        }
        if done - last > 512 * 1024 {
            last = done;
            report(done, total);
        }
    }
    report(out.len() as u64, total);
    Ok(out)
}

pub fn sha1_hex(b: &[u8]) -> String {
    hex::encode(Sha1::digest(b))
}

pub fn megabytes(n: u64) -> String {
    format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
}

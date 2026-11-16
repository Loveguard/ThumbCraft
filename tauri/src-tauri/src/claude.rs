// Lets Claude (or any MCP client) work inside the running app: a Model Context Protocol server on this computer
// only (127.0.0.1), guarded by a random key. Each tool call is handed to the window, which edits the scene the
// same way the panels do (renderer/src/claudeBridge.ts), so everything Claude does shows on screen, can be
// undone, and is saved with the project. Port of main/claude.ts; same address file and key as the Electron
// build, so mcp/thumbcraft-mcp.cjs and `claude mcp add` setups keep working.
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use crate::settings;
use crate::util::{emit, err, user_data, write_atomic, Res};

const DEFAULT_PORT: u16 = 47821;
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY: u64 = 8 * 1024 * 1024;
const ALLOWED_EXT: [&str; 10] = ["png", "jpg", "jpeg", "psd", "mp4", "webm", "gif", "zip", "bfproj", "glb"];

static KEY: Mutex<String> = Mutex::new(String::new());
static TOOLS: LazyLock<Mutex<Option<Vec<Value>>>> = LazyLock::new(Mutex::default);
static SERVER: LazyLock<Mutex<Option<std::sync::Arc<tiny_http::Server>>>> = LazyLock::new(Mutex::default);

fn bridge_file() -> PathBuf {
    user_data().join("claude-bridge.json")
}

fn tools_file() -> PathBuf {
    user_data().join("claude-tools.json")
}

// ------------------------------------------------------------------ window round trip

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static WAITING: LazyLock<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>> = LazyLock::new(Mutex::default);

fn ask_window(method: &str, params: &Value, timeout: Duration) -> Res<Value> {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    WAITING.lock().unwrap().insert(id, tx);
    emit("claude:request", json!({ "id": id, "method": method, "params": params }));
    let r = rx.recv_timeout(timeout);
    WAITING.lock().unwrap().remove(&id);
    match r {
        Ok(v) => v,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err(format!("ThumbCraft took longer than {} s to do \"{method}\"", timeout.as_secs()))
        }
        Err(_) => Err("ThumbCraft is closing".into()),
    }
}

/// The window's answer to a request (see platform/tauri.ts).
pub fn respond(id: u64, ok: bool, result: Option<Value>, error: Option<String>) {
    if let Some(tx) = WAITING.lock().unwrap().remove(&id) {
        let _ = tx.send(if ok {
            Ok(result.unwrap_or(Value::Null))
        } else {
            Err(error.filter(|e| !e.is_empty()).unwrap_or_else(|| "Something went wrong in ThumbCraft".into()))
        });
    }
}

/// The window hands over the tool list (shared/claudeTools.ts) when it starts; kept on disk for the launcher,
/// which lists the tools even while the app is closed.
pub fn register_tools(tools: Vec<Value>) {
    let list = tool_list(&tools);
    *TOOLS.lock().unwrap() = Some(tools);
    let _ = write_atomic(&tools_file(), json!({ "tools": list }).to_string().as_bytes());
}

fn tool_list(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({
                "name": t["name"], "title": t["title"], "description": t["description"], "inputSchema": t["inputSchema"],
                "annotations": {
                    "readOnlyHint": t["readOnly"].as_bool().unwrap_or(false),
                    "destructiveHint": t["destructive"].as_bool().unwrap_or(false),
                    "openWorldHint": false
                }
            })
        })
        .collect()
}

/// The tools, waiting a little for the window to register them right after start.
fn tools() -> Vec<Value> {
    for _ in 0..100 {
        if let Some(t) = TOOLS.lock().unwrap().as_ref() {
            return t.clone();
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    vec![]
}

// ------------------------------------------------------------------ files Claude asks for

fn ext_of(p: &str) -> Option<String> {
    Path::new(p).extension().and_then(|e| e.to_str()).map(str::to_lowercase)
}

fn only_known() -> String {
    format!("ThumbCraft only writes {} files", ALLOWED_EXT.map(|e| format!(".{e}")).join(", "))
}

/// A file Claude asked to write: an absolute path, or a name inside Pictures/ThumbCraft. Only known file types.
fn output_path(wanted: &Value, fallback: &str, ext: &str) -> Res<PathBuf> {
    let w = wanted.as_str().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(fallback);
    let mut path = PathBuf::from(w);
    if !path.is_absolute() {
        path = dirs::picture_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default()).join("ThumbCraft").join(path);
    }
    if path.extension().is_none() {
        let mut s = path.into_os_string();
        s.push(ext);
        path = PathBuf::from(s);
    }
    if !ext_of(&path.to_string_lossy()).is_some_and(|e| ALLOWED_EXT.contains(&e.as_str())) {
        return Err(only_known());
    }
    if let Some(d) = path.parent() {
        fs::create_dir_all(d).map_err(err)?;
    }
    Ok(path)
}

fn safe_name(s: &Value) -> String {
    let raw = s.as_str().filter(|s| !s.is_empty()).unwrap_or("thumbnail");
    let mut out = String::new();
    let mut last_bad = false;
    for c in raw.chars() {
        let bad = "<>:\"/\\|?*".contains(c) || (c as u32) < 0x20;
        if bad {
            if !last_bad {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
        last_bad = bad;
    }
    let out: String = out.trim().chars().take(80).collect();
    if out.is_empty() {
        "thumbnail".into()
    } else {
        out
    }
}

// ------------------------------------------------------------------ tools

fn call_tool(tool: &Value, mut args: Value) -> Res<Vec<Value>> {
    let name = tool["name"].as_str().unwrap_or("");
    // A file type ThumbCraft won't write is refused before anything is rendered.
    if let Some(p) = args["path"].as_str() {
        if ext_of(p).is_some_and(|e| !ALLOWED_EXT.contains(&e.as_str())) {
            return Err(only_known());
        }
    }
    // Pictures from this computer are read here (the window has no file access) and handed over as bytes.
    if name == "add_image" {
        if let Some(file) = args["file"].as_str().map(str::to_string) {
            let mime = match ext_of(&file).as_deref() {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                Some("gif") => "image/gif",
                _ => return Err("file must be a .png, .jpg, .webp or .gif picture".into()),
            };
            let bytes = fs::read(&file).map_err(err)?;
            if bytes.len() > 64 * 1024 * 1024 {
                return Err("That picture is over 64 MB".into());
            }
            let base = Path::new(&file).file_name().and_then(|n| n.to_str()).unwrap_or("picture").to_string();
            if args["name"].is_null() {
                args["name"] = json!(base);
            }
            args["file"] = Value::Null;
            args["data"] = json!(base64::engine::general_purpose::STANDARD.encode(bytes));
            args["mime"] = json!(mime);
        }
    }
    let slow = tool["slow"].as_bool().unwrap_or(false);
    let timeout = Duration::from_secs(if slow { 15 * 60 } else { 90 });
    let result = ask_window(name, &args, timeout)?;
    let mut content = Vec::new();
    match result {
        Value::Object(mut rest) => {
            let image = rest.remove("image");
            if let Some(file) = rest.remove("file") {
                let ext = file["ext"].as_str().unwrap_or(".png").to_string();
                let path = output_path(&args["path"], &safe_name(&file["name"]), &ext)?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(file["base64"].as_str().unwrap_or(""))
                    .map_err(err)?;
                if ext == ".bfproj" {
                    write_atomic(&path, &bytes)?;
                } else {
                    fs::write(&path, bytes).map_err(err)?;
                }
                rest.insert("savedTo".into(), json!(path.to_string_lossy()));
            }
            if !rest.is_empty() {
                content.push(json!({ "type": "text", "text": Value::Object(rest).to_string() }));
            }
            if let Some(img) = image {
                content.push(json!({ "type": "image", "data": img["base64"], "mimeType": img["mimeType"] }));
            }
        }
        Value::Null => {}
        other => content.push(json!({ "type": "text", "text": other.to_string() })),
    }
    if content.is_empty() {
        content.push(json!({ "type": "text", "text": "Done." }));
    }
    Ok(content)
}

// ------------------------------------------------------------------ MCP over HTTP (JSON-RPC 2.0)

const INSTRUCTIONS: &str = "These tools control the ThumbCraft window that is open on this computer: a Minecraft thumbnail studio. Start with get_scene (what is in the picture, with object ids) and get_options (valid ids for poses, looks, biomes, templates, mobs, animation blocks). Use screenshot to look at the result after changes; check your work visually before saying it is finished. Positions are in blocks (y up, the ground is usually y=0), rotations in degrees, yaw = rotation[1]. Everything you do can be undone with undo.";

fn handle_rpc(msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    if id.is_null() {
        return None; // a notification: nothing to answer
    }
    let reply = |result: Value| Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    let fail = |code: i64, message: String| Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }));
    let method = msg["method"].as_str().unwrap_or("");
    match method {
        "initialize" => {
            let asked = msg["params"]["protocolVersion"].as_str().unwrap_or("");
            let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
            reply(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "thumbcraft", "title": "ThumbCraft", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS
            }))
        }
        "ping" => reply(json!({})),
        "tools/list" => reply(json!({ "tools": tool_list(&tools()) })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("").to_string();
            let Some(tool) = tools().into_iter().find(|t| t["name"] == name) else {
                return fail(-32602, format!("Unknown tool: {name}"));
            };
            let args = msg["params"]["arguments"].clone();
            let args = if args.is_object() { args } else { json!({}) };
            match call_tool(&tool, args) {
                Ok(content) => reply(json!({ "content": content })),
                Err(e) => reply(json!({ "content": [{ "type": "text", "text": e }], "isError": true })),
            }
        }
        _ => fail(-32601, format!("Method not found: {method}")),
    }
}

fn header<'a>(req: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn authorised(req: &tiny_http::Request) -> bool {
    let given = header(req, "authorization").unwrap_or("");
    let given = given.strip_prefix("Bearer ").or_else(|| given.strip_prefix("bearer ")).unwrap_or(given).trim();
    let want = KEY.lock().unwrap().clone();
    // Constant-time comparison.
    given.len() == want.len() && given.bytes().zip(want.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn handle_http(mut req: tiny_http::Request) {
    let send = |req: tiny_http::Request, status: u16, body: Option<Value>| {
        let mut r = tiny_http::Response::from_string(body.map(|b| b.to_string()).unwrap_or_default()).with_status_code(status);
        if status != 202 && status != 405 {
            r = r.with_header("content-type: application/json".parse::<tiny_http::Header>().unwrap());
        }
        let _ = req.respond(r);
    };
    // Web pages can reach localhost too; a page has an Origin, the MCP clients don't.
    if header(&req, "origin").is_some() {
        return send(req, 403, Some(json!({ "error": "Browsers may not use this server" })));
    }
    if req.url().split('?').next() != Some("/mcp") {
        return send(req, 404, Some(json!({ "error": "Not found" })));
    }
    if !authorised(&req) {
        return send(req, 401, Some(json!({ "error": "Missing or wrong key (see claude-bridge.json)" })));
    }
    match req.method() {
        tiny_http::Method::Get => return send(req, 405, None),
        tiny_http::Method::Delete => return send(req, 200, Some(json!({}))),
        tiny_http::Method::Post => {}
        _ => return send(req, 405, None),
    }
    let mut body = Vec::new();
    if req.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY {
        return send(req, 413, Some(json!({ "error": "Request too large" })));
    }
    let Ok(parsed) = serde_json::from_slice::<Value>(&body) else {
        return send(req, 400, Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } })));
    };
    let batch = parsed.is_array();
    let messages = if batch { parsed.as_array().cloned().unwrap_or_default() } else { vec![parsed] };
    let answers: Vec<Value> = messages.iter().filter_map(handle_rpc).collect();
    if answers.is_empty() {
        return send(req, 202, None);
    }
    let out = if batch { Value::Array(answers) } else { answers.into_iter().next().unwrap() };
    send(req, 200, Some(out));
}

/// Starts the server (unless turned off with "claudeBridge": false in settings.json) and writes where it is.
pub fn start() {
    if settings::get("claudeBridge") == Some(Value::Bool(false)) || SERVER.lock().unwrap().is_some() {
        return;
    }
    // The key stays the same from one start to the next, so a client set up once keeps working.
    let old = fs::read(bridge_file()).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let mut key = old.and_then(|o| o["key"].as_str().map(str::to_string)).filter(|k| k.len() >= 24).unwrap_or_default();
    if key.is_empty() {
        let bytes: [u8; 24] = rand::random();
        key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    }
    *KEY.lock().unwrap() = key.clone();
    // Another ThumbCraft (or something else) has the port: take the next one.
    for port in DEFAULT_PORT..=DEFAULT_PORT + 10 {
        let Ok(server) = tiny_http::Server::http(("127.0.0.1", port)) else { continue };
        let server = std::sync::Arc::new(server);
        *SERVER.lock().unwrap() = Some(server.clone());
        let info = json!({
            "url": format!("http://127.0.0.1:{port}/mcp"), "key": key,
            "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION")
        });
        if let Err(e) = write_atomic(&bridge_file(), serde_json::to_string_pretty(&info).unwrap().as_bytes()) {
            eprintln!("Could not write claude-bridge.json: {e}");
        }
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                std::thread::spawn(move || handle_http(req));
            }
        });
        return;
    }
    eprintln!("Claude bridge could not start: ports {DEFAULT_PORT}-{} are taken", DEFAULT_PORT + 10);
}

pub fn stop() {
    if let Some(s) = SERVER.lock().unwrap().take() {
        s.unblock();
    }
    for (_, tx) in WAITING.lock().unwrap().drain() {
        let _ = tx.send(Err("ThumbCraft is closing".into()));
    }
}

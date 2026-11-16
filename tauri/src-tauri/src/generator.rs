// Generates real Minecraft terrain by running the official dedicated server headlessly: the vanilla world
// generator places every block, and we read the result from its region files (port of main/generator.ts).
use serde::Deserialize;
use serde_json::json;
use sha1::{Digest, Sha1};
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::anvil::{extract_terrain, ChunkCache, ExtractOptions, RegionSource, Terrain};
use crate::assets::locate_command_of;
use crate::java::find_java;
use crate::mojang::ensure_server_jar;
use crate::settings;
use crate::util::{cache_dir, command, err, lower_priority, mtime_ms, now_ms, remove_quietly, Res};

pub type Progress = Arc<dyn Fn(&str, &str) + Send + Sync>;
pub type Cancel = Arc<AtomicBool>;

/// The error a cancelled generation ends with (the window shows it as a plain "cancelled").
pub const CANCELLED: &str = "Generation cancelled";

fn cancelled(c: Option<&Cancel>) -> bool {
    c.is_some_and(|c| c.load(Ordering::SeqCst))
}

// ------------------------------------------------------------------------------------------ worldgen helpers

const NETHER: &str = "the_nether";
const CAVE_BIOMES: [&str; 3] = ["lush_caves", "dripstone_caves", "deep_dark"];

/// Where a world keeps a dimension's region files, newest layout first.
fn region_dirs(dimension: &str) -> [String; 2] {
    let legacy = match dimension {
        "the_nether" => "DIM-1/region",
        "the_end" => "DIM1/region",
        _ => "region",
    };
    [format!("dimensions/minecraft/{dimension}/region"), legacy.to_string()]
}

struct Located {
    x: i32,
    y: Option<i32>,
    z: i32,
}

/// Parses "The nearest minecraft:desert is at [-1234, 72, 567] (1300 blocks away)".
fn parse_locate(line: &str) -> Option<Located> {
    static RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"The nearest (\S+) is at \[(-?\d+), (~|-?\d+), (-?\d+)\]").unwrap());
    let c = RE.captures(line)?;
    Some(Located { x: c[2].parse().ok()?, y: c[3].parse().ok(), z: c[4].parse().ok()? })
}

fn is_server_ready(line: &str) -> bool {
    static RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r": Done \(\d").unwrap());
    RE.is_match(line)
}

/// Gamerules for the generator world: nothing ticks, burns or spawns (unknown names on older versions are ignored).
const SERVER_GAMERULES: [&str; 6] = [
    "spawnChunkRadius 0",
    "randomTickSpeed 0",
    "doFireTick false",
    "doDaylightCycle false",
    "doWeatherCycle false",
    "doMobSpawning false",
];

fn server_properties(seed: &str, port: u16, level: &str) -> String {
    [
        format!("level-seed={seed}"),
        format!("level-name={level}"),
        format!("server-port={port}"),
        // Only this computer may connect; the generator never needs the network.
        "server-ip=127.0.0.1".into(),
        "online-mode=false".into(),
        "enable-rcon=false".into(),
        "enable-query=false".into(),
        "motd=ThumbCraft terrain generator".into(),
        "max-players=1".into(),
        "view-distance=3".into(),
        "simulation-distance=3".into(),
        "spawn-protection=0".into(),
        // A throwaway cache world: don't fsync every chunk on save.
        "sync-chunk-writes=false".into(),
        "region-file-compression=deflate".into(),
        "max-tick-time=-1".into(),
        "generate-structures=true".into(),
        "white-list=true".into(),
        String::new(),
    ]
    .join("\n")
}

fn free_port() -> Res<u16> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(err)?;
    Ok(l.local_addr().map_err(err)?.port())
}

fn total_memory_mb() -> u64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(t) = fs::read_to_string("/proc/meminfo") {
            if let Some(kb) = t.lines().next().and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse::<u64>().ok()) {
                return kb / 1024;
            }
        }
    }
    #[cfg(windows)]
    {
        #[repr(C)]
        struct MemoryStatusEx {
            length: u32,
            load: u32,
            total_phys: u64,
            avail_phys: u64,
            total_page: u64,
            avail_page: u64,
            total_virtual: u64,
            avail_virtual: u64,
            avail_ext: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(buf: *mut MemoryStatusEx) -> i32;
        }
        let mut m: MemoryStatusEx = unsafe { std::mem::zeroed() };
        m.length = std::mem::size_of::<MemoryStatusEx>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut m) } != 0 {
            return m.total_phys / (1024 * 1024);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut size: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = b"hw.memsize\0";
        let ok = unsafe {
            libc::sysctlbyname(name.as_ptr() as *const _, &mut size as *mut u64 as *mut _, &mut len, std::ptr::null_mut(), 0)
        };
        if ok == 0 {
            return size / (1024 * 1024);
        }
    }
    8192
}

// ------------------------------------------------------------------------------------------ the server

#[derive(Default)]
struct LineLog {
    /// Recent lines; `base` is the number of lines dropped from the front.
    lines: VecDeque<String>,
    base: usize,
    exited: bool,
}

struct Session {
    version: String,
    seed: String,
    dir: PathBuf,
    level: String,
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    log: Arc<(Mutex<LineLog>, Condvar)>,
}

impl Session {
    fn start(version: &str, seed: &str, dir: &Path, level: &str, java: &Path, jar: &Path, major: u32, on_line: Progress) -> Res<Arc<Session>> {
        // A quarter of the machine's memory, between 1 and 4 GB: enough for worldgen without starving the game.
        let max_mb = (total_memory_mb() / 4).clamp(1024, 4096);
        let mut args = vec!["-Xms512M".to_string(), format!("-Xmx{max_mb}M")];
        // Java 19+ can reuse its class-loading work between launches (AppCDS), trimming start-up.
        if major >= 19 {
            args.push("-XX:+AutoCreateSharedArchive".into());
            args.push(format!("-XX:SharedArchiveFile={}", dir.join("blockframe.jsa").to_string_lossy()));
        }
        args.extend(["-jar".into(), jar.to_string_lossy().to_string(), "nogui".into()]);
        // Background work at a lower priority, keeping the app and the game responsive; no console window.
        let mut child = command(java, true)
            .args(&args)
            .current_dir(dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't start Java ({}): {e}", java.to_string_lossy()))?;
        lower_priority(child.id());
        let log: Arc<(Mutex<LineLog>, Condvar)> = Arc::default();
        let open = Arc::new(AtomicUsize::new(2));
        let feed = |stream: Box<dyn Read + Send>| {
            let log = log.clone();
            let open = open.clone();
            let on_line = on_line.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.split(b'\n').map_while(Result::ok) {
                    let line = String::from_utf8_lossy(&line).trim_end().to_string();
                    on_line(&line, "");
                    let (m, cv) = &*log;
                    let mut l = m.lock().unwrap();
                    l.lines.push_back(line);
                    if l.lines.len() > 4000 {
                        l.lines.pop_front();
                        l.base += 1;
                    }
                    cv.notify_all();
                }
                if open.fetch_sub(1, Ordering::SeqCst) == 1 {
                    let (m, cv) = &*log;
                    m.lock().unwrap().exited = true;
                    cv.notify_all();
                }
            });
        };
        feed(Box::new(child.stdout.take().unwrap()));
        feed(Box::new(child.stderr.take().unwrap()));
        let stdin = child.stdin.take();
        Ok(Arc::new(Session {
            version: version.into(),
            seed: seed.into(),
            dir: dir.into(),
            level: level.into(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            log,
        }))
    }

    fn exited(&self) -> bool {
        self.log.0.lock().unwrap().exited
    }

    /// Where the next line will be; pass it to wait_for to see only lines after a command.
    fn mark(&self) -> usize {
        let l = self.log.0.lock().unwrap();
        l.base + l.lines.len()
    }

    /// The most telling recent server lines (errors and warnings first), for error messages.
    fn why(&self) -> String {
        static BANNER: LazyLock<regex::Regex> = LazyLock::new(|| {
            regex::Regex::new(r#"OFFLINE/INSECURE|authenticate usernames|without internet access|ability for hackers|"online-mode""#).unwrap()
        });
        static BAD: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"ERROR|Exception|Error:|WARN|OutOfMemory|UnsupportedClassVersion").unwrap());
        static PREFIX: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"^\[[^\]]*\]\s*(\[[^\]]*\]:?\s*)?").unwrap());
        let l = self.log.0.lock().unwrap();
        let tail: Vec<&String> = l.lines.iter().rev().take(40).rev().filter(|x| !BANNER.is_match(x)).collect();
        let bad: Vec<&&String> = tail.iter().filter(|x| BAD.is_match(x)).collect();
        let pick: Vec<String> = if bad.is_empty() {
            tail.iter().rev().take(6).rev().map(|x| PREFIX.replace(x, "").to_string()).collect()
        } else {
            bad.iter().rev().take(6).rev().map(|x| PREFIX.replace(x, "").to_string()).collect()
        };
        if pick.is_empty() {
            return String::new();
        }
        format!(
            "\n\nServer said:\n{}\n\nFull log: {}",
            pick.join("\n"),
            self.dir.join("logs").join("latest.log").to_string_lossy()
        )
    }

    fn send(&self, cmd: &str) {
        if let Some(stdin) = self.stdin.lock().unwrap().as_mut() {
            let _ = stdin.write_all(format!("{cmd}\n").as_bytes());
            let _ = stdin.flush();
        }
    }

    /// Waits for a line after `mark` that `matcher` accepts. The matcher may fail the wait with an error.
    fn wait_for<T>(
        &self,
        mut mark: usize,
        mut matcher: impl FnMut(&str) -> Res<Option<T>>,
        timeout: Duration,
        what: &str,
        cancel: Option<&Cancel>,
    ) -> Res<T> {
        let deadline = Instant::now() + timeout;
        let (m, cv) = &*self.log;
        let mut l = m.lock().unwrap();
        loop {
            if cancelled(cancel) {
                return Err(CANCELLED.into());
            }
            mark = mark.max(l.base);
            while mark < l.base + l.lines.len() {
                let line = l.lines[mark - l.base].clone();
                mark += 1;
                if let Some(v) = matcher(&line)? {
                    return Ok(v);
                }
            }
            if l.exited {
                drop(l);
                return Err(format!("Minecraft server exited while waiting to {what}{}", self.why()));
            }
            let now = Instant::now();
            if now >= deadline {
                drop(l);
                return Err(format!("Timed out waiting for the server to {what}{}", self.why()));
            }
            l = cv.wait_timeout(l, (deadline - now).min(Duration::from_millis(100))).unwrap().0;
        }
    }

    fn kill(&self) {
        if !self.exited() {
            let _ = self.child.lock().unwrap().kill();
        }
    }

    /// An orderly stop; after `grace` the server is killed (its world is only a disposable cache).
    fn stop(&self, grace: Duration) {
        if self.exited() {
            return;
        }
        self.send("stop");
        let (m, cv) = &*self.log;
        let deadline = Instant::now() + grace;
        let mut l = m.lock().unwrap();
        while !l.exited && Instant::now() < deadline {
            l = cv.wait_timeout(l, Duration::from_millis(100)).unwrap().0;
        }
        let done = l.exited;
        drop(l);
        if !done {
            let _ = self.child.lock().unwrap().kill();
        }
        let _ = self.child.lock().unwrap().wait();
    }

    fn world(&self) -> PathBuf {
        self.dir.join(&self.level)
    }
}

/// The world's region folder for a dimension, in whichever layout this version writes; None if none yet.
fn find_region_dir(world: &Path, dimension: &str) -> Option<PathBuf> {
    region_dirs(dimension).iter().map(|d| world.join(d)).find(|d| {
        fs::read_dir(d).map(|r| r.flatten().any(|e| e.path().extension().is_some_and(|x| x == "mca"))).unwrap_or(false)
    })
}

/// Reads region files on demand (looking the folder up again until it exists).
fn region_reader(world: PathBuf, dimension: String) -> RegionSource {
    let dir: Mutex<Option<PathBuf>> = Mutex::new(None);
    Box::new(move |rx, rz| {
        let mut d = dir.lock().unwrap();
        if d.is_none() {
            *d = find_region_dir(&world, &dimension);
        }
        let p = d.as_ref()?.join(format!("r.{rx}.{rz}.mca"));
        fs::read(p).ok()
    })
}

#[derive(Default)]
struct GenState {
    session: Option<Arc<Session>>,
    /// A server still starting up, so quitting mid-start never leaves its JVM running.
    pending: Option<Arc<Session>>,
}

static STATE: LazyLock<Mutex<GenState>> = LazyLock::new(Mutex::default);
/// Concurrent callers share one start-up.
static STARTING: Mutex<()> = Mutex::new(());
static IDLE: AtomicU64 = AtomicU64::new(0);

/// Stops the server. `quick` (on quit) gives it a few seconds to save before killing it.
pub fn shutdown(quick: bool) {
    IDLE.fetch_add(1, Ordering::SeqCst);
    let (pending, stopped) = {
        let mut st = STATE.lock().unwrap();
        (st.pending.take(), st.session.take())
    };
    if let Some(p) = pending {
        p.kill();
    }
    if let Some(s) = stopped {
        s.stop(Duration::from_secs(if quick { 3 } else { 20 }));
        // Every blank-seed generation adds chunks at a new spot, so the default world only grows; it is a
        // throwaway cache, so start it over once it gets big.
        if folder_size(&s.world()) > MAX_WORLD {
            remove_quietly(&s.world());
        }
    }
}

/// The generator's worlds and caches are disposable: past these sizes and ages they are deleted.
const MAX_WORLD: u64 = 512 * 1024 * 1024;
const KEEP_TERRAINS: usize = 60;
const UNUSED_FOR: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;

fn folder_size(dir: &Path) -> u64 {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                folder_size(&p)
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

fn names_in(dir: &Path) -> Vec<String> {
    fs::read_dir(dir).map(|r| r.flatten().filter_map(|e| e.file_name().to_str().map(String::from)).collect()).unwrap_or_default()
}

/// Clears what earlier runs left behind: worlds of other seeds in this version's server folder, and the server
/// folders of Minecraft versions not used for a month (each holds a server jar and its worlds).
fn clean_generator_cache(version: &str, level: &str) {
    let server_dir = cache_dir(&["server", version]);
    for name in names_in(&server_dir) {
        if name.starts_with("world_") && name != level {
            remove_quietly(&server_dir.join(name));
        }
    }
    let root = cache_dir(&["server"]);
    for other in names_in(&root) {
        let props = root.join(&other).join("server.properties");
        if other != version && props.exists() && now_ms() - mtime_ms(&props) > UNUSED_FOR {
            remove_quietly(&root.join(other));
        }
    }
}

/// Ready-made areas for a version, biome or size nobody has asked for in a month.
fn drop_unused_pools() {
    let root = cache_dir(&[POOL_DIR]);
    for name in names_in(&root) {
        if now_ms() - mtime_ms(&root.join(&name)) > UNUSED_FOR {
            remove_quietly(&root.join(name));
        }
    }
}

/// Keeps only the newest `keep` files (or folders) in a cache folder.
fn keep_newest(dir: &Path, keep: usize) {
    let mut list: Vec<(f64, PathBuf)> = names_in(dir).into_iter().map(|n| (mtime_ms(&dir.join(&n)), dir.join(n))).collect();
    list.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (_, p) in list.into_iter().skip(keep) {
        remove_quietly(&p);
    }
}

/// The seed of the world ThumbCraft generates in when no seed is typed; kept so the server never restarts for it.
fn default_seed() -> String {
    if let Some(s) = settings::get_str("genSeed") {
        return s;
    }
    let seed = (rand::random::<u64>() % (1u64 << 53)) as i64 - (1i64 << 52);
    let seed = seed.to_string();
    settings::set("genSeed", json!(seed));
    seed
}

/// Starts (or reuses) the vanilla server for a version and seed.
fn ensure_session(version: &str, seed: &str, progress: &Progress) -> Res<Arc<Session>> {
    let current = || {
        let st = STATE.lock().unwrap();
        st.session.clone().filter(|s| !s.exited() && s.version == version && s.seed == seed)
    };
    if let Some(s) = current() {
        return Ok(s);
    }
    let _starting = STARTING.lock().unwrap();
    if let Some(s) = current() {
        return Ok(s);
    }
    // A different world: save quickly and kill instead of waiting for a slow orderly stop.
    let old = STATE.lock().unwrap().session.take();
    if let Some(old) = old {
        if !old.exited() {
            old.send("save-all");
            std::thread::sleep(Duration::from_millis(300));
            old.kill();
        }
    }
    let server_dir = cache_dir(&["server", version]);
    let jar = server_dir.join("server.jar");
    fs::create_dir_all(&server_dir).map_err(err)?;
    progress("download", "Checking official server jar…");
    let vj = ensure_server_jar(version, &jar, &|m| progress("download", m))?;
    let need = vj["javaVersion"]["majorVersion"].as_u64().unwrap_or(17) as u32;
    let java = find_java(need).ok_or_else(|| {
        format!("Java {need}+ is required. Use \"Install Java\" in the Biomes tab (one click), or launch this version once in the official launcher.")
    })?;
    // The exact seed's hash keeps seeds that read alike ("my seed", "my_seed") in separate worlds.
    let hash = &hex::encode(Sha1::digest(seed.as_bytes()))[..8];
    let cleaned: String = seed.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).take(24).collect();
    let level = format!("world_{cleaned}_{hash}");
    clean_generator_cache(version, &level);
    fs::write(server_dir.join("eula.txt"), "eula=true\n").map_err(err)?;
    fs::write(server_dir.join("server.properties"), server_properties(seed, free_port()?, &level)).map_err(err)?;
    progress("start", &format!("Starting vanilla world generator (Java {})…", java.major));
    let p2 = progress.clone();
    let on_line: Progress = Arc::new(move |line: &str, _| {
        if line.contains("Preparing spawn area") || line.contains("Preparing level") {
            let msg = line.find("]: ").map(|i| &line[i + 3..]).unwrap_or(line);
            p2("start", msg);
        }
    });
    let s = Session::start(version, seed, &server_dir, &level, Path::new(&java.path), &jar, java.major, on_line)?;
    STATE.lock().unwrap().pending = Some(s.clone());
    let ready = s.wait_for(0, |l| Ok(is_server_ready(l).then_some(())), Duration::from_secs(600), "finish starting", None);
    {
        let mut st = STATE.lock().unwrap();
        if st.pending.as_ref().is_some_and(|p| Arc::ptr_eq(p, &s)) {
            st.pending = None;
        }
    }
    if let Err(e) = ready {
        s.kill();
        return Err(e);
    }
    if s.exited() {
        return Err("The world generator was stopped while starting".into());
    }
    // Nothing needs to tick in this world: no fire spreading through the captured trees, no mobs, no weather.
    for rule in SERVER_GAMERULES {
        s.send(&format!("gamerule {rule}"));
    }
    STATE.lock().unwrap().session = Some(s.clone());
    Ok(s)
}

/// Shut the server down after a while unused (it holds 1–2 GB of memory).
fn touch_idle() {
    let mine = IDLE.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(600));
        if IDLE.load(Ordering::SeqCst) == mine {
            shutdown(false);
        }
    });
}

// One generation at a time on the server; the user's clicks always go before background pre-generation.
static EXCLUSIVE: Mutex<()> = Mutex::new(());
static USER_WAITING: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, PartialEq)]
struct Job {
    version: String,
    dimension: String,
    biome: String,
    size: usize,
    seed: String,
    /// Where to search from (a random spot in the default world, so blank-seed requests vary).
    from: Option<(i32, i32)>,
    /// Queued because the user picked this biome (replaced when they pick another).
    prefetch: bool,
}

impl Job {
    fn same_area(&self, o: &Job) -> bool {
        self.version == o.version && self.dimension == o.dimension && self.biome == o.biome && self.size == o.size
    }
}

/// Versions whose server doesn't answer `execute if loaded` on the console, and ones that do.
static NO_LOADED_CHECK: LazyLock<Mutex<std::collections::HashSet<String>>> = LazyLock::new(Mutex::default);
static LOADED_CHECK_WORKS: LazyLock<Mutex<std::collections::HashSet<String>>> = LazyLock::new(Mutex::default);

fn generate_now(job: &Job, progress: &Progress, cancel: Option<&Cancel>) -> Res<Terrain> {
    if cancelled(cancel) {
        return Err(CANCELLED.into());
    }
    let s = abortable(
        {
            let (v, seed, p) = (job.version.clone(), job.seed.clone(), progress.clone());
            move || ensure_session(&v, &seed, &p)
        },
        cancel,
    )?;
    touch_idle();
    let dim = format!("minecraft:{}", job.dimension);
    let biome = if job.biome.contains(':') { job.biome.clone() } else { format!("minecraft:{}", job.biome) };
    progress("locate", &format!("Locating {biome}…"));
    // 1.19+ uses "locate biome"; 1.18.x used "locatebiome" (same reply format).
    let locate = locate_command_of(&job.version);
    let at = job.from.map(|(x, z)| format!("positioned {x} 0 {z} ")).unwrap_or_default();
    let mark = s.mark();
    s.send(&format!("execute in {dim} {at}run {locate} {biome}"));
    let found = s.wait_for(
        mark,
        |l| {
            if l.to_lowercase().contains("could not find a biome of type") {
                return Err(format!("No {biome} found nearby for this seed — try another seed"));
            }
            Ok(parse_locate(l))
        },
        Duration::from_secs(90),
        "locate the biome",
        cancel,
    )?;

    let half = (job.size as i32 + 1) / 2 + 2;
    let (x1, z1, x2, z2) = (found.x - half, found.z - half, found.x + half, found.z + half);
    progress("generate", &format!("Generating chunks around {}, {}…", found.x, found.z));
    s.send(&format!("execute in {dim} run forceload add {x1} {z1} {x2} {z2}"));

    // One cheap question instead of saving the whole world over and over: "is every chunk of the area loaded?"
    // (chained `execute if loaded`, 1.18+). Only when it says yes is the world saved once and read back.
    let mut checks = Vec::new();
    for cx in (x1 >> 4)..=(x2 >> 4) {
        for cz in (z1 >> 4)..=(z2 >> 4) {
            checks.push(format!("if loaded {} 0 {}", cx * 16 + 8, cz * 16 + 8));
        }
    }
    let all_loaded = format!("execute in {dim} {}", checks.join(" "));
    let new_cache = || ChunkCache::new(region_reader(s.world(), job.dimension.clone()));
    let mut last_cache: Option<ChunkCache> = None;
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut saves = 0;
    let result = (|| -> Res<()> {
        let mut wait = 150u64;
        loop {
            sleep_cancellable(Duration::from_millis(wait), cancel)?;
            wait = (wait as f64 * 1.5).round().min(600.0) as u64;
            let mut ready = "yes";
            if !NO_LOADED_CHECK.lock().unwrap().contains(&job.version) {
                // Until a version has answered once, give it a few seconds; some versions never reply.
                let answered = LOADED_CHECK_WORKS.lock().unwrap().contains(&job.version);
                let mark = s.mark();
                s.send(&all_loaded);
                let reply = s.wait_for(
                    mark,
                    |l| {
                        Ok(if l.contains("Test passed") {
                            Some("yes")
                        } else if l.contains("Test failed") {
                            Some("no")
                        } else {
                            let low = l.to_lowercase();
                            (low.contains("unknown or incomplete command")
                                || low.contains("incorrect argument")
                                || low.contains("unknown command"))
                            .then_some("unsupported")
                        })
                    },
                    Duration::from_secs(if answered { 30 } else { 4 }),
                    "check the chunks",
                    cancel,
                );
                ready = match reply {
                    Ok(r) => r,
                    Err(e) if e == CANCELLED || answered => return Err(e),
                    Err(_) => "unsupported", // no reply at all: this version doesn't report the check
                };
                if ready == "yes" || ready == "no" {
                    LOADED_CHECK_WORKS.lock().unwrap().insert(job.version.clone());
                }
                // A version without the check: save and read the region files each round instead (always works).
                if ready == "unsupported" {
                    NO_LOADED_CHECK.lock().unwrap().insert(job.version.clone());
                    ready = "yes";
                }
            }
            if ready == "yes" {
                let mark = s.mark();
                s.send("save-all flush");
                s.wait_for(mark, |l| Ok(l.contains("Saved the game").then_some(())), Duration::from_secs(60), "save", cancel)?;
                saves += 1;
                let mut c = new_cache();
                let done = c.all_generated(x1 >> 4, z1 >> 4, x2 >> 4, z2 >> 4)?;
                last_cache = Some(c);
                if done {
                    return Ok(());
                }
                // Saved several times and still no region files: the world isn't where we look. Say so now.
                if saves >= 4 && find_region_dir(&s.world(), &job.dimension).is_none() {
                    return Err(format!(
                        "The server saved the world but no region files appeared in {} under {}. This Minecraft version may store worlds differently.",
                        region_dirs(&job.dimension).join(" or "),
                        s.world().to_string_lossy()
                    ));
                }
            }
            if Instant::now() > deadline {
                let mut c = new_cache();
                let status = match c.chunk(x1 >> 4, z1 >> 4)? {
                    Some(ch) => format!("status \"{}\"", ch.status),
                    None => "not saved yet".into(),
                };
                return Err(format!("Chunks did not finish generating in 90 seconds (first chunk: {status})."));
            }
        }
    })();
    // Also on cancel: the server stops working on this area straight away.
    s.send(&format!("execute in {dim} run forceload remove {x1} {z1} {x2} {z2}"));
    result?;

    progress("extract", "Reading blocks…");
    let bare = biome.trim_start_matches("minecraft:");
    let underground = job.dimension == NETHER || CAVE_BIOMES.contains(&bare);
    let mut cache = last_cache.unwrap_or_else(new_cache);
    let terrain = extract_terrain(
        &mut cache,
        &ExtractOptions {
            center_x: found.x,
            center_z: found.z,
            size: job.size,
            dimension: job.dimension.clone(),
            focus_y: underground.then(|| found.y.unwrap_or(64)),
        },
    )?;
    touch_idle();
    progress("done", &format!("Generated {biome} at {}, {} (seed {})", found.x, found.z, job.seed));
    Ok(terrain)
}

fn sleep_cancellable(d: Duration, cancel: Option<&Cancel>) -> Res<()> {
    let end = Instant::now() + d;
    while Instant::now() < end {
        if cancelled(cancel) {
            return Err(CANCELLED.into());
        }
        std::thread::sleep(Duration::from_millis(25).min(end - Instant::now()));
    }
    if cancelled(cancel) {
        return Err(CANCELLED.into());
    }
    Ok(())
}

/// Runs `job` on its own thread and returns its result, or CANCELLED as soon as `cancel` is set (the job itself
/// keeps running, e.g. a server start).
fn abortable<T: Send + 'static>(job: impl FnOnce() -> Res<T> + Send + 'static, cancel: Option<&Cancel>) -> Res<T> {
    let Some(cancel) = cancel else { return job() };
    if cancel.load(Ordering::SeqCst) {
        return Err(CANCELLED.into());
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(job());
    });
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(r) => return r,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("The generator stopped unexpectedly".into()),
            Err(mpsc::RecvTimeoutError::Timeout) if cancel.load(Ordering::SeqCst) => return Err(CANCELLED.into()),
            Err(_) => {}
        }
    }
}

/// Runs a job with the server to itself (one generation at a time).
fn exclusive<T>(job: impl FnOnce() -> Res<T>) -> Res<T> {
    let _g = EXCLUSIVE.lock().unwrap_or_else(|e| e.into_inner());
    job()
}

// ---------------------------------------------------------------------------------------------------------
// Finished areas on disk. Typed seeds are cached by exact request; blank-seed requests take a ready-made area
// from a small pool that is refilled in the background, so popular biomes appear instantly. (Folders of their
// own: the Electron build keeps its areas in a format this one can't read.)

const EXACT_DIR: &str = "terrain-v3";
const POOL_DIR: &str = "terrain-pool-v3";

fn hash(text: &str) -> String {
    hex::encode(Sha1::digest(text.as_bytes()))[..24].to_string()
}

fn exact_file(j: &Job) -> PathBuf {
    let key = json!({ "v": j.version, "d": j.dimension, "b": j.biome, "s": j.seed, "n": j.size }).to_string();
    cache_dir(&[EXACT_DIR, &format!("{}.bin", hash(&key))])
}

fn pool_dir(j: &Job) -> PathBuf {
    let key = json!({ "v": j.version, "d": j.dimension, "b": j.biome, "n": j.size }).to_string();
    cache_dir(&[POOL_DIR, &hash(&key)])
}

fn write_terrain(file: &Path, packed: &[u8]) {
    let _ = fs::create_dir_all(file.parent().unwrap());
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    if gz.write_all(packed).is_ok() {
        if let Ok(bytes) = gz.finish() {
            let tmp = file.with_extension("tmp");
            if fs::write(&tmp, bytes).is_ok() {
                let _ = fs::rename(&tmp, file);
            }
        }
    }
}

fn read_terrain(file: &Path) -> Option<Vec<u8>> {
    let bytes = fs::read(file).ok()?;
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(&bytes[..]).read_to_end(&mut out).ok()?;
    Terrain::packed_is_valid(&out).then_some(out)
}

fn take_from_pool(j: &Job) -> Option<Vec<u8>> {
    let dir = pool_dir(j);
    for f in names_in(&dir).into_iter().filter(|n| n.ends_with(".bin")) {
        let t = read_terrain(&dir.join(&f));
        let _ = fs::remove_file(dir.join(&f));
        if t.is_some() {
            return t;
        }
    }
    None
}

fn pool_has(j: &Job) -> bool {
    names_in(&pool_dir(j)).iter().any(|n| n.ends_with(".bin"))
}

fn random_spot() -> (i32, i32) {
    let r = || ((rand::random::<f64>() * 2.0 - 1.0) * 20000.0).round() as i32;
    (r(), r())
}

/// Background pre-generation: runs only while the user isn't waiting for a generation.
static BACKGROUND: LazyLock<Mutex<VecDeque<Job>>> = LazyLock::new(Mutex::default);
static PUMPING: AtomicBool = AtomicBool::new(false);
/// The background area being generated right now (a user asking for the same biome waits for it).
static INFLIGHT: LazyLock<Mutex<Option<(Job, Arc<(Mutex<bool>, Condvar)>)>>> = LazyLock::new(Mutex::default);

fn pump() {
    if PUMPING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        loop {
            if USER_WAITING.load(Ordering::SeqCst) > 0 {
                break;
            }
            let Some(job) = BACKGROUND.lock().unwrap().pop_front() else { break };
            if pool_has(&job) {
                continue;
            }
            let done: Arc<(Mutex<bool>, Condvar)> = Arc::default();
            *INFLIGHT.lock().unwrap() = Some((job.clone(), done.clone()));
            let quiet: Progress = Arc::new(|_, _| {});
            let spot = Job { from: Some(random_spot()), ..job.clone() };
            // A biome that can't be found nearby just isn't pre-generated.
            if let Ok(t) = exclusive(|| generate_now(&spot, &quiet, None)) {
                write_terrain(&pool_dir(&job).join(format!("{}.bin", now_ms() as u64)), &t.to_packed());
                drop_unused_pools();
            }
            *INFLIGHT.lock().unwrap() = None;
            *done.0.lock().unwrap() = true;
            done.1.notify_all();
        }
        PUMPING.store(false, Ordering::SeqCst);
        // A job queued while this pump was finishing must not wait for the next request.
        if USER_WAITING.load(Ordering::SeqCst) == 0 && !BACKGROUND.lock().unwrap().is_empty() {
            pump();
        }
    });
}

fn refill(base: &Job) {
    let mut q = BACKGROUND.lock().unwrap();
    if q.iter().any(|b| b.same_area(base)) {
        return;
    }
    q.push_back(Job { seed: default_seed(), from: None, prefetch: false, ..base.clone() });
    drop(q);
    pump();
}

/// Biomes thumbnail makers reach for most; pre-generated in the background once the server is warm.
const POPULAR: [(&str, &str); 10] = [
    ("overworld", "plains"),
    ("overworld", "cherry_grove"),
    ("overworld", "desert"),
    ("overworld", "dark_forest"),
    ("overworld", "snowy_plains"),
    ("overworld", "jungle"),
    ("overworld", "badlands"),
    ("overworld", "mushroom_fields"),
    ("the_nether", "nether_wastes"),
    ("the_nether", "crimson_forest"),
];

fn safe_version(v: &str) -> bool {
    (1..=64).contains(&v.len())
        && v.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.' || c == '-' || c == ' ')
        && !v.contains("..")
}

fn safe_id(v: &str) -> bool {
    (1..=100).contains(&v.len()) && v.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_.-:/".contains(c))
}

const DIMENSIONS: [&str; 3] = ["overworld", "the_nether", "the_end"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub version: String,
    pub dimension: String,
    pub biome: String,
    pub size: f64,
    #[serde(default)]
    pub seed: Option<String>,
    #[serde(default)]
    pub accept_eula: bool,
}

fn check_request(version: &str, dimension: &str, biome: &str, seed: &str) -> Res<()> {
    if !safe_version(version) {
        return Err("Invalid version".into());
    }
    if !safe_id(biome) {
        return Err("Invalid biome".into());
    }
    if !DIMENSIONS.contains(&dimension) {
        return Err("Invalid dimension".into());
    }
    if seed.chars().count() > 64 || seed.contains(['\r', '\n', '=', '\\']) {
        return Err("Seeds can be up to 64 characters, on one line".into());
    }
    Ok(())
}

fn valid_size(size: f64) -> Option<usize> {
    (size.fract() == 0.0 && (8.0..=256.0).contains(&size)).then_some(size as usize)
}

/// Starts the generator in the background (after the user has accepted the EULA) and queues the popular biomes,
/// so the first Generate is quick and common picks are instant.
pub fn prewarm(version: &str, available: &[String], size: f64) {
    let Some(size) = valid_size(size) else { return };
    if !safe_version(version) || !settings::eula_accepted() {
        return;
    }
    let quiet: Progress = Arc::new(|_, _| {});
    let seed = default_seed();
    if exclusive(|| ensure_session(version, &seed, &quiet)).is_err() {
        return; // the user will see the real error when they press Generate
    }
    touch_idle();
    for (dimension, biome) in POPULAR {
        if available.iter().any(|b| b == biome && safe_id(b)) {
            refill(&Job {
                version: version.into(),
                dimension: dimension.into(),
                biome: biome.into(),
                size,
                seed: String::new(),
                from: None,
                prefetch: false,
            });
        }
    }
}

/// Starts generating a biome in the background as soon as the user picks it, so by the time they press Generate
/// it is often ready (blank seed only; typed seeds are generated on request).
pub fn prefetch(version: &str, dimension: &str, biome: &str, size: f64) {
    if !settings::eula_accepted() || check_request(version, dimension, biome, "").is_err() {
        return;
    }
    let Some(size) = valid_size(size) else { return };
    let base = Job {
        version: version.into(),
        dimension: dimension.into(),
        biome: biome.into(),
        size,
        seed: String::new(),
        from: None,
        prefetch: true,
    };
    // Only the biome the user is looking at now: drop earlier picks that haven't started, and jump the queue.
    BACKGROUND.lock().unwrap().retain(|b| !b.prefetch);
    let busy = INFLIGHT.lock().unwrap().as_ref().is_some_and(|(j, _)| j.same_area(&base));
    if pool_has(&base) || busy {
        return;
    }
    BACKGROUND.lock().unwrap().push_front(Job { seed: default_seed(), ..base });
    pump();
}

/// Counts the user as waiting while alive (background work pauses), and restarts the pump afterwards.
struct Waiting;
impl Waiting {
    fn new() -> Self {
        USER_WAITING.fetch_add(1, Ordering::SeqCst);
        Waiting
    }
}
impl Drop for Waiting {
    fn drop(&mut self) {
        USER_WAITING.fetch_sub(1, Ordering::SeqCst);
        pump();
    }
}

/// Generates the requested area and returns it packed (see anvil::Terrain::to_packed).
pub fn generate(req: GenerateRequest, progress: Progress, cancel: Cancel) -> Res<Vec<u8>> {
    let run = || -> Res<Vec<u8>> {
        if !req.accept_eula {
            return Err("You need to accept the Minecraft EULA to run the vanilla world generator".into());
        }
        let size = valid_size(req.size).ok_or("Invalid area size")?;
        let seed = req.seed.clone().unwrap_or_default();
        check_request(&req.version, &req.dimension, &req.biome, &seed)?;
        let explicit = seed.trim().to_string();
        let base = Job {
            version: req.version.clone(),
            dimension: req.dimension.clone(),
            biome: req.biome.clone(),
            size,
            seed: String::new(),
            from: None,
            prefetch: false,
        };
        if !explicit.is_empty() {
            let job = Job { seed: explicit.clone(), ..base.clone() };
            if let Some(cached) = read_terrain(&exact_file(&job)) {
                progress("done", &format!("Loaded {} (seed {explicit}) from cache", req.biome));
                return Ok(cached);
            }
            let _w = Waiting::new();
            // Waiting in the queue (behind background work) can be cancelled too.
            let (j, p, c) = (job.clone(), progress.clone(), cancel.clone());
            let t = abortable(move || exclusive(|| generate_now(&j, &p, Some(&c))).map(|t| t.to_packed()), Some(&cancel))?;
            write_terrain(&exact_file(&job), &t);
            keep_newest(exact_file(&job).parent().unwrap(), KEEP_TERRAINS);
            return Ok(t);
        }
        // No seed typed: a ready-made area if there is one, otherwise a random spot in the default world.
        let mut ready = take_from_pool(&base);
        // Already being generated in the background (picked a moment ago): wait for that instead of starting over.
        let inflight = INFLIGHT.lock().unwrap().as_ref().filter(|(j, _)| j.same_area(&base)).map(|(_, d)| d.clone());
        if ready.is_none() {
            if let Some(done) = inflight {
                progress("generate", &format!("Finishing {} (already started when you picked it)…", req.biome));
                let (m, cv) = &*done;
                let mut finished = m.lock().unwrap();
                while !*finished {
                    if cancel.load(Ordering::SeqCst) {
                        return Err(CANCELLED.into());
                    }
                    finished = cv.wait_timeout(finished, Duration::from_millis(100)).unwrap().0;
                }
                drop(finished);
                ready = take_from_pool(&base);
            }
        }
        refill(&base);
        if let Some(t) = ready {
            progress("done", &format!("Ready-made {} loaded instantly", req.biome));
            return Ok(t);
        }
        let _w = Waiting::new();
        let job = Job { seed: default_seed(), from: Some(random_spot()), ..base };
        let (p, c) = (progress.clone(), cancel.clone());
        abortable(move || exclusive(|| generate_now(&job, &p, Some(&c))).map(|t| t.to_packed()), Some(&cancel))
    };
    run().inspect_err(|e| progress("error", e))
}

/// Cuts terrain out of an existing singleplayer world save (1.18+).
pub fn import_world(world_dir: &Path, dimension: &str, center_x: i32, center_y: Option<i32>, center_z: i32, size: usize) -> Res<Vec<u8>> {
    if find_region_dir(world_dir, dimension).is_none() {
        return Err(format!("No region files for that dimension in {}", world_dir.to_string_lossy()));
    }
    let mut cache = ChunkCache::new(region_reader(world_dir.to_path_buf(), dimension.into()));
    let t = extract_terrain(
        &mut cache,
        &ExtractOptions {
            center_x,
            center_z,
            size,
            dimension: dimension.into(),
            // The Nether has a bedrock roof, so slice around a chosen height instead of following the top.
            focus_y: center_y.or((dimension == NETHER).then_some(64)),
        },
    )?;
    Ok(t.to_packed())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_server_lines() {
        let l = parse_locate("[12:00:00] [Server thread/INFO]: The nearest minecraft:desert is at [-1234, ~, 567] (1300 blocks away)").unwrap();
        assert_eq!((l.x, l.y, l.z), (-1234, None, 567));
        assert!(is_server_ready("[12:00:00] [Server thread/INFO]: Done (3.123s)! For help, type \"help\""));
        assert!(check_request("1.21.4", "overworld", "plains", "my seed").is_ok());
        assert!(check_request("1.21.4", "overworld", "plains", "a=b").is_err());
        assert!(check_request("../x", "overworld", "plains", "").is_err());
        assert_eq!(valid_size(48.0), Some(48));
        assert_eq!(valid_size(7.0), None);
    }
}

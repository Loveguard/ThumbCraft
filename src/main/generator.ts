// Generates real Minecraft terrain by running the official dedicated server headlessly:
// the vanilla world generator places every block, and we read the result from its region files.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { setPriority, totalmem } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import v8 from 'node:v8'
import { gunzipSync, gzipSync } from 'node:zlib'
import { ChunkCache, extractTerrain, type RegionSource } from '@shared/minecraft/anvil'
import {
  CAVE_BIOMES,
  isLocateFailure,
  isServerReady,
  parseLocate,
  regionDirs,
  SERVER_GAMERULES,
  serverProperties
} from '@shared/minecraft/worldgen'
import type { JavaInfo } from '@shared/api'
import type { Dimension, GenerateProgress, GenerateRequest, TerrainData, WorldImportRequest } from '@shared/types'
import { cacheDir, currentJar, locateCommandOf, launcherJavaCandidates, versionJsonPath } from './assets'
import { ensureServerJar } from './mojang'
import { readSettings, updateSettings } from './settings'

type Progress = (p: GenerateProgress) => void

function javaMajor(path: string): Promise<(JavaInfo & { major: number }) | null> {
  // `java -version` writes to stderr, so read both streams. Async, so probing never freezes the app.
  return new Promise((resolve) =>
    execFile(path, ['-version'], { encoding: 'utf8', timeout: 10000, windowsHide: true }, (err, stdout, stderr) =>
      resolve(err && !stderr ? null : parseJavaVersion(path, `${stderr ?? ''}\n${stdout ?? ''}`))
    )
  )
}

function parseJavaVersion(path: string, text: string): (JavaInfo & { major: number }) | null {
  const m = /version "([^"]+)"/.exec(text)
  if (!m) return null
  const parts = m[1].split(/[._-]/).map(Number)
  const major = parts[0] === 1 ? parts[1] : parts[0]
  return { path, version: m[1], major }
}

let javas: Promise<(JavaInfo & { major: number })[]> | null = null

/** Forget the probed runtimes (after installing one). */
export function rescanJava(): void {
  javas = null
}

/** The Java the loaded Minecraft version needs (its version json says; 17 is the floor for our tools). */
export function requiredJava(version: string): number {
  const file = versionJsonPath(version, currentJar() || undefined)
  try {
    const need = file ? (JSON.parse(readFileSync(file, 'utf8')) as { javaVersion?: { majorVersion?: number } }) : null
    return Math.max(17, need?.javaVersion?.majorVersion ?? 21)
  } catch {
    return 21
  }
}

/**
 * `java` from PATH, looked up by hand: spawning a bare "java" on Windows would also try the current folder
 * first, so a java.exe dropped next to the portable app could be run.
 */
function javaOnPath(): string[] {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d && isAbsolute(d))
    .map((d) => join(d, exe))
    .filter((p) => existsSync(p))
    .slice(0, 1)
}

/** The newest Java at least `minMajor`. Runtimes are probed once per app run, in parallel (each probe starts a JVM). */
export async function findJava(minMajor = 0): Promise<(JavaInfo & { major: number }) | null> {
  javas ??= Promise.all([...launcherJavaCandidates(), ...javaOnPath()].map((p) => javaMajor(p))).then((all) =>
    all.filter((j): j is JavaInfo & { major: number } => !!j).sort((a, b) => b.major - a.major)
  )
  return (await javas).find((j) => j.major >= minMajor) ?? null
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })

class ServerSession {
  private proc: ChildProcessWithoutNullStreams
  private listeners = new Set<(line: string) => void>()
  private buffer = ''
  /** The server's last lines, quoted in errors so a crash says why (out of memory, wrong Java, bad jar). */
  private tail: string[] = []
  exited = false

  constructor(
    readonly version: string,
    readonly seed: string,
    readonly dir: string,
    readonly levelName: string,
    java: string,
    jar: string,
    javaMajor: number,
    onLine: (line: string) => void
  ) {
    // A quarter of the machine's memory, between 1 and 4 GB: enough for worldgen without starving the game.
    const maxMb = Math.max(1024, Math.min(4096, Math.floor(totalmem() / 4 / 2 ** 20)))
    const args = ['-Xms512M', `-Xmx${maxMb}M`]
    // Java 19+ can reuse its class-loading work between launches (AppCDS), trimming start-up.
    if (javaMajor >= 19)
      args.push('-XX:+AutoCreateSharedArchive', `-XX:SharedArchiveFile=${join(dir, 'blockframe.jsa')}`)
    // windowsHide: no console window that the user could close (killing generation).
    this.proc = spawn(java, [...args, '-jar', jar, 'nogui'], { cwd: dir, windowsHide: true })
    // World generation is background work: keep the app and the game responsive.
    try {
      if (this.proc.pid) setPriority(this.proc.pid, 10)
    } catch {
      // not permitted on this system
    }
    const feed = (chunk: Buffer): void => {
      this.buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trimEnd()
        this.buffer = this.buffer.slice(nl + 1)
        this.tail.push(line)
        if (this.tail.length > 40) this.tail.shift()
        onLine(line)
        this.listeners.forEach((l) => l(line))
      }
    }
    this.proc.stdout.on('data', feed)
    this.proc.stderr.on('data', feed)
    const ended = (): void => {
      if (this.exited) return
      this.exited = true
      this.listeners.forEach((l) => l('__EXIT__'))
    }
    this.proc.on('exit', ended)
    // A Java that fails to start, or a write after the server quit, must not crash the app.
    this.proc.on('error', (e) => {
      this.tail.push(`ERROR: ${e.message}`)
      ended()
    })
    this.proc.stdin.on('error', () => undefined)
  }

  /** The most telling recent server lines (errors and warnings first), for error messages. */
  private why(): string {
    // The offline-mode banner is expected (the generator only listens on this computer); never quote it.
    const banner = /OFFLINE\/INSECURE|authenticate usernames|without internet access|ability for hackers|"online-mode"/
    const tail = this.tail.filter((l) => !banner.test(l))
    const bad = tail.filter((l) => /ERROR|Exception|Error:|WARN|OutOfMemory|UnsupportedClassVersion/.test(l))
    const lines = (bad.length ? bad : tail).slice(-6).map((l) => l.replace(/^\[[^\]]*\]\s*(\[[^\]]*\]:?\s*)?/, ''))
    return lines.length
      ? `\n\nServer said:\n${lines.join('\n')}\n\nFull log: ${join(this.dir, 'logs', 'latest.log')}`
      : ''
  }

  send(command: string): void {
    if (this.exited || this.proc.stdin.destroyed) return
    this.proc.stdin.write(`${command}\n`)
  }

  waitFor<T>(
    match: (line: string) => T | null | undefined | false,
    timeoutMs: number,
    what: string,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(cancelled())
      const onAbort = (): void => {
        clearTimeout(timer)
        this.listeners.delete(listener)
        reject(cancelled())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        this.listeners.delete(listener)
        signal?.removeEventListener('abort', onAbort)
        reject(new Error(`Timed out waiting for the server to ${what}${this.why()}`))
      }, timeoutMs)
      const listener = (line: string): void => {
        if (line === '__EXIT__') {
          clearTimeout(timer)
          this.listeners.delete(listener)
          signal?.removeEventListener('abort', onAbort)
          reject(new Error(`Minecraft server exited while waiting to ${what}${this.why()}`))
          return
        }
        let r: T | null | undefined | false
        try {
          r = match(line)
        } catch (e) {
          clearTimeout(timer)
          this.listeners.delete(listener)
          signal?.removeEventListener('abort', onAbort)
          reject(e)
          return
        }
        if (r) {
          clearTimeout(timer)
          this.listeners.delete(listener)
          signal?.removeEventListener('abort', onAbort)
          resolve(r)
        }
      }
      this.listeners.add(listener)
    })
  }

  kill(): void {
    if (!this.exited) this.proc.kill()
  }

  /** An orderly stop; after `graceMs` the server is killed (its world is only a disposable cache). */
  async stop(graceMs = 20000): Promise<void> {
    if (this.exited) return
    this.send('stop')
    await this.waitFor((l) => l === '__EXIT__', graceMs, 'stop').catch(() => this.proc.kill())
  }

  world(): string {
    return join(this.dir, this.levelName)
  }

  regionSource(dimension: Dimension): RegionSource {
    return regionReader(this.world(), dimension)
  }
}

let session: ServerSession | null = null
/** A server still starting up (not yet `session`), so quitting mid-start never leaves its JVM running. */
let pending: ServerSession | null = null
let starting: Promise<ServerSession> | null = null
let idleTimer: NodeJS.Timeout | null = null

/** Stops the server. `quick` (on quit) gives it a few seconds to save before killing it. */
export async function shutdownGenerator(quick = false): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer)
  pending?.kill()
  pending = null
  await session?.stop(quick ? 3000 : 20000)
  session = null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The error a cancelled generation ends with (the renderer shows it as a plain "cancelled"). */
export const CANCELLED = 'Generation cancelled'
const cancelled = (): Error => new Error(CANCELLED)

/** Resolves like `p`, or rejects as soon as `signal` aborts (`p` itself keeps running, e.g. a server start). */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(cancelled())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => (signal.removeEventListener('abort', onAbort), resolve(v)),
      (e) => (signal.removeEventListener('abort', onAbort), reject(e))
    )
  })
}

/** The seed of the world ThumbCraft generates in when no seed is typed; kept so the server never restarts for it. */
function defaultSeed(): string {
  const saved = readSettings().genSeed
  if (saved) return saved
  const seed = String(Math.floor(Math.random() * 2 ** 53) - 2 ** 52)
  updateSettings({ genSeed: seed })
  return seed
}

/** Starts (or reuses) the vanilla server for a version and seed. Concurrent callers share one start-up. */
async function ensureSession(version: string, seed: string, progress: Progress): Promise<ServerSession> {
  if (session && !session.exited && session.version === version && session.seed === seed) return session
  if (starting) {
    const s = await starting
    if (!s.exited && s.version === version && s.seed === seed) return s
  }
  starting = (async () => {
    // A different world: save quickly and kill instead of waiting for a slow orderly stop.
    if (session && !session.exited) {
      session.send('save-all')
      await sleep(300)
      session.kill()
    }
    session = null
    const serverDir = cacheDir('server', version)
    const jar = join(serverDir, 'server.jar')
    mkdirSync(serverDir, { recursive: true })
    progress({ stage: 'download', message: 'Checking official server jar…' })
    const vj = await ensureServerJar(version, jar, (m) => progress({ stage: 'download', message: m }))
    const need = vj.javaVersion?.majorVersion ?? 17
    const java = await findJava(need)
    if (!java)
      throw new Error(
        `Java ${need}+ is required. Use "Install Java" in the Biomes tab (one click), or launch this version once in the official launcher.`
      )
    const levelName = `world_${seed.replace(/[^A-Za-z0-9-]/g, '_').slice(0, 40)}`
    writeFileSync(join(serverDir, 'eula.txt'), 'eula=true\n')
    writeFileSync(join(serverDir, 'server.properties'), serverProperties(seed, await freePort(), levelName))
    progress({ stage: 'start', message: `Starting vanilla world generator (Java ${java.major})…` })
    const s = new ServerSession(version, seed, serverDir, levelName, java.path, jar, java.major, (line) => {
      if (/Preparing spawn area|Preparing level/.test(line))
        progress({ stage: 'start', message: line.replace(/^\[.*?\]: /, '') })
    })
    pending = s
    try {
      await s.waitFor(isServerReady, 10 * 60 * 1000, 'finish starting')
    } catch (e) {
      s.kill()
      throw e
    } finally {
      if (pending === s) pending = null
    }
    if (s.exited) throw new Error('The world generator was stopped while starting')
    // Nothing needs to tick in this world: no fire spreading through the captured trees, no mobs, no weather.
    for (const rule of SERVER_GAMERULES) s.send(`gamerule ${rule}`)
    session = s
    return s
  })()
  try {
    return await starting
  } finally {
    starting = null
  }
}

/** Shut the server down after a while unused (it holds 1–2 GB of memory). */
function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void shutdownGenerator(), 10 * 60 * 1000)
}

// One generation at a time on the server; the user's clicks always go before background pre-generation.
let chain: Promise<unknown> = Promise.resolve()
let userWaiting = 0
const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
  const p = chain.then(job, job)
  chain = p.catch(() => undefined)
  return p
}

interface Job {
  version: string
  dimension: Dimension
  biome: string
  size: number
  seed: string
  /** Where to search from (a random spot in the default world, so blank-seed requests vary). */
  from?: { x: number; z: number }
  /** Queued because the user picked this biome (replaced when they pick another). */
  prefetch?: boolean
}

/** Versions whose server doesn't answer `execute if loaded` on the console, and ones that do. */
const noLoadedCheck = new Set<string>()
const loadedCheckWorks = new Set<string>()

async function generateNow(job: Job, progress: Progress, signal?: AbortSignal): Promise<TerrainData> {
  signal?.throwIfAborted()
  const s = await abortable(ensureSession(job.version, job.seed, progress), signal)
  touchIdle()
  const dim = `minecraft:${job.dimension}`
  const biome = job.biome.includes(':') ? job.biome : `minecraft:${job.biome}`
  progress({ stage: 'locate', message: `Locating ${biome}…` })
  // 1.19+ uses "locate biome"; 1.18.x used "locatebiome" (same reply format).
  const locate = locateCommandOf(job.version)
  const at = job.from ? `positioned ${job.from.x} 0 ${job.from.z} ` : ''
  s.send(`execute in ${dim} ${at}run ${locate} ${biome}`)
  const found = await s.waitFor(
    (l) => {
      if (isLocateFailure(l)) throw new Error(`No ${biome} found nearby for this seed — try another seed`)
      return parseLocate(l)
    },
    90 * 1000,
    'locate the biome',
    signal
  )

  const half = Math.ceil(job.size / 2) + 2
  const [x1, z1, x2, z2] = [found.x - half, found.z - half, found.x + half, found.z + half]
  progress({ stage: 'generate', message: `Generating chunks around ${found.x}, ${found.z}…` })
  s.send(`execute in ${dim} run forceload add ${x1} ${z1} ${x2} ${z2}`)

  // A fresh cache per check (region files change while the server saves); the last one that passed is reused.
  let lastCache: ChunkCache | null = null
  const cache = (): ChunkCache => (lastCache = new ChunkCache(s.regionSource(job.dimension)))
  const deadline = Date.now() + 90 * 1000
  let saves = 0
  // One cheap question instead of saving the whole world over and over: "is every chunk of the area loaded?"
  // (chained `execute if loaded`, 1.18+). Only when it says yes is the world saved once and read back.
  const chunks: string[] = []
  for (let cx = x1 >> 4; cx <= x2 >> 4; cx++)
    for (let cz = z1 >> 4; cz <= z2 >> 4; cz++) chunks.push(`if loaded ${cx * 16 + 8} 0 ${cz * 16 + 8}`)
  const allLoaded = `execute in ${dim} ${chunks.join(' ')}`
  try {
    for (let wait = 150; ; wait = Math.min(600, Math.round(wait * 1.5))) {
      await abortable(sleep(wait), signal)
      let ready: string = 'yes'
      if (!noLoadedCheck.has(job.version)) {
        s.send(allLoaded)
        // Until a version has answered once, give it a few seconds; some versions never reply on the console.
        const answered = loadedCheckWorks.has(job.version)
        ready = await s
          .waitFor(
            (l) =>
              /Test passed/.test(l)
                ? 'yes'
                : /Test failed/.test(l)
                  ? 'no'
                  : /Unknown or incomplete command|Incorrect argument|Unknown command/i.test(l)
                    ? 'unsupported'
                    : null,
            answered ? 30000 : 4000,
            'check the chunks',
            signal
          )
          .catch((e: Error) => {
            if (e.message === CANCELLED || answered) throw e
            return 'unsupported' // no reply at all: this version doesn't report the check
          })
        if (ready === 'yes' || ready === 'no') loadedCheckWorks.add(job.version)
        // A version without the check: save and read the region files each round instead (always works).
        if (ready === 'unsupported') {
          noLoadedCheck.add(job.version)
          ready = 'yes'
        }
      }
      if (ready === 'yes') {
        s.send('save-all flush')
        await s.waitFor((l) => /Saved the game/.test(l), 60000, 'save', signal)
        saves++
        if (cache().allGenerated(x1 >> 4, z1 >> 4, x2 >> 4, z2 >> 4)) break
        // Saved several times and still no region files: the world isn't where we look. Say so now.
        if (saves >= 4 && !findRegionDir(s.world(), job.dimension))
          throw new Error(
            `The server saved the world but no region files appeared in ${regionDirs(job.dimension).join(' or ')} ` +
              `under ${s.world()}. This Minecraft version may store worlds differently.`
          )
      }
      if (Date.now() > deadline) {
        const c = cache().chunk(x1 >> 4, z1 >> 4)
        throw new Error(
          `Chunks did not finish generating in 90 seconds (first chunk: ${c ? `status "${c.status}"` : 'not saved yet'}).`
        )
      }
    }
  } finally {
    // Also on cancel: the server stops working on this area straight away.
    s.send(`execute in ${dim} run forceload remove ${x1} ${z1} ${x2} ${z2}`)
  }

  progress({ stage: 'extract', message: 'Reading blocks…' })
  const underground = job.dimension === 'the_nether' || CAVE_BIOMES.includes(biome.replace('minecraft:', ''))
  const terrain = extractTerrain(lastCache ?? cache(), {
    centerX: found.x,
    centerZ: found.z,
    size: job.size,
    dimension: job.dimension,
    focusY: underground ? (found.y ?? 64) : undefined
  })
  touchIdle()
  progress({ stage: 'done', message: `Generated ${biome} at ${found.x}, ${found.z} (seed ${job.seed})` })
  return terrain
}

// ---------------------------------------------------------------------------------------------------------
// Finished areas on disk. Typed seeds are cached by exact request; blank-seed requests take a ready-made area
// from a small pool that is refilled in the background, so popular biomes appear instantly.

const CACHE_FORMAT = 1
const hash = (o: unknown): string => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 24)
const exactFile = (j: Job): string =>
  cacheDir(
    'terrain',
    `${hash({ f: CACHE_FORMAT, v: j.version, d: j.dimension, b: j.biome, s: j.seed, n: j.size })}.bin`
  )
const poolDir = (j: Pick<Job, 'version' | 'dimension' | 'biome' | 'size'>): string =>
  cacheDir('terrain-pool', hash({ f: CACHE_FORMAT, v: j.version, d: j.dimension, b: j.biome, n: j.size }))

function writeTerrain(file: string, t: TerrainData): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, gzipSync(v8.serialize(t), { level: 1 }))
  renameSync(`${file}.tmp`, file)
}
function readTerrain(file: string): TerrainData | null {
  try {
    return v8.deserialize(gunzipSync(readFileSync(file))) as TerrainData
  } catch {
    return null
  }
}

function takeFromPool(j: Job): TerrainData | null {
  const dir = poolDir(j)
  if (!existsSync(dir)) return null
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.bin'))) {
    const t = readTerrain(join(dir, f))
    rmSync(join(dir, f), { force: true })
    if (t) return t
  }
  return null
}
const poolHas = (j: Job): boolean => existsSync(poolDir(j)) && readdirSync(poolDir(j)).some((n) => n.endsWith('.bin'))

const randomSpot = (): { x: number; z: number } => {
  const r = (): number => Math.round((Math.random() * 2 - 1) * 20000)
  return { x: r(), z: r() }
}

// Background pre-generation: runs only while the user isn't waiting for a generation.
const background: Job[] = []
let pumping = false
/** The background area being generated right now (a user asking for the same biome waits for it). */
let inflight: { job: Job; done: Promise<void> } | null = null
const sameArea = (a: Omit<Job, 'seed'>, b: Omit<Job, 'seed'>): boolean =>
  a.version === b.version && a.dimension === b.dimension && a.biome === b.biome && a.size === b.size
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (background.length && userWaiting === 0) {
      const job = background.shift()!
      if (poolHas(job)) continue
      const done = exclusive(() => generateNow({ ...job, from: randomSpot() }, () => undefined)).then(
        (t) => writeTerrain(join(poolDir(job), `${Date.now()}.bin`), t),
        () => undefined // a biome that can't be found nearby just isn't pre-generated
      )
      inflight = { job, done }
      try {
        await done
      } finally {
        inflight = null
      }
    }
  } finally {
    pumping = false
  }
}
function refill(job: Omit<Job, 'seed' | 'from'>): void {
  if (
    background.some(
      (b) => b.version === job.version && b.dimension === job.dimension && b.biome === job.biome && b.size === job.size
    )
  )
    return
  background.push({ ...job, seed: defaultSeed() })
  void pump()
}

/** Biomes thumbnail makers reach for most; pre-generated in the background once the server is warm. */
const POPULAR: { dimension: Dimension; biome: string }[] = [
  { dimension: 'overworld', biome: 'plains' },
  { dimension: 'overworld', biome: 'cherry_grove' },
  { dimension: 'overworld', biome: 'desert' },
  { dimension: 'overworld', biome: 'dark_forest' },
  { dimension: 'overworld', biome: 'snowy_plains' },
  { dimension: 'overworld', biome: 'jungle' },
  { dimension: 'overworld', biome: 'badlands' },
  { dimension: 'overworld', biome: 'mushroom_fields' },
  { dimension: 'the_nether', biome: 'nether_wastes' },
  { dimension: 'the_nether', biome: 'crimson_forest' }
]

/**
 * Starts the generator in the background (after the user has accepted the EULA) and queues the popular
 * biomes, so the first Generate is quick and common picks are instant.
 */
export async function prewarmGenerator(version: string, available: string[], size: number): Promise<void> {
  if (!SAFE_VERSION.test(version) || !Number.isInteger(size) || size < 8 || size > 256) return
  available = available.filter((b) => SAFE_ID.test(b))
  if (readSettings().eulaAccepted !== true) return
  try {
    await exclusive(() => ensureSession(version, defaultSeed(), () => undefined))
    touchIdle()
  } catch {
    return // the user will see the real error when they press Generate
  }
  for (const p of POPULAR) if (available.includes(p.biome)) refill({ version, size, ...p })
}

// Seeds, biomes and versions end up in server.properties, console commands and folder names.
const SAFE_VERSION = /^[\w.\- ]{1,64}$/
const SAFE_ID = /^[a-z0-9_.\-:/]{1,100}$/
const DIMENSIONS: Dimension[] = ['overworld', 'the_nether', 'the_end']
function checkRequest(req: GenerateRequest): void {
  if (!SAFE_VERSION.test(String(req.version)) || req.version.includes('..')) throw new Error('Invalid version')
  if (!SAFE_ID.test(String(req.biome))) throw new Error('Invalid biome')
  if (!DIMENSIONS.includes(req.dimension)) throw new Error('Invalid dimension')
  if (!/^[^\r\n=\\]{0,64}$/.test(String(req.seed ?? '')))
    throw new Error('Seeds can be up to 64 characters, on one line')
}

/**
 * Starts generating a biome in the background as soon as the user picks it, so by the time they press
 * Generate it is often ready (blank seed only; typed seeds are generated on request).
 */
export function prefetchBiome(version: string, dimension: Dimension, biome: string, size: number): void {
  if (readSettings().eulaAccepted !== true) return
  try {
    checkRequest({ version, dimension, biome, size, seed: '' })
  } catch {
    return
  }
  if (!Number.isInteger(size) || size < 8 || size > 256) return
  const base = { version, dimension, biome, size }
  // Only the biome the user is looking at now: drop earlier picks that haven't started, and jump the queue.
  for (let i = background.length - 1; i >= 0; i--) if (background[i].prefetch) background.splice(i, 1)
  if (poolHas({ ...base, seed: '' }) || (inflight && sameArea(inflight.job, base))) return
  background.unshift({ ...base, seed: defaultSeed(), prefetch: true })
  void pump()
}

export async function generateTerrain(
  req: GenerateRequest & { acceptEula: boolean },
  progress: Progress,
  signal?: AbortSignal
): Promise<TerrainData> {
  if (!req.acceptEula) throw new Error('You need to accept the Minecraft EULA to run the vanilla world generator')
  if (!Number.isInteger(req.size) || req.size < 8 || req.size > 256) throw new Error('Invalid area size')
  checkRequest(req)
  const explicit = String(req.seed ?? '').trim()
  const base = { version: req.version, dimension: req.dimension, biome: req.biome, size: req.size }
  try {
    if (explicit) {
      const job: Job = { ...base, seed: explicit }
      const cached = existsSync(exactFile(job)) ? readTerrain(exactFile(job)) : null
      if (cached) {
        progress({ stage: 'done', message: `Loaded ${req.biome} (seed ${explicit}) from cache` })
        return cached
      }
      userWaiting++
      try {
        // Waiting in the queue (behind background work) can be cancelled too.
        const t = await abortable(
          exclusive(() => generateNow(job, progress, signal)),
          signal
        )
        writeTerrain(exactFile(job), t)
        return t
      } finally {
        userWaiting--
        void pump()
      }
    }
    // No seed typed: a ready-made area if there is one, otherwise a random spot in the default world.
    let ready = takeFromPool({ ...base, seed: '' })
    // Already being generated in the background (picked a moment ago): wait for that instead of starting over.
    if (!ready && inflight && sameArea(inflight.job, base)) {
      progress({ stage: 'generate', message: `Finishing ${req.biome} (already started when you picked it)…` })
      await abortable(inflight.done, signal)
      ready = takeFromPool({ ...base, seed: '' })
    }
    refill(base)
    if (ready) {
      progress({ stage: 'done', message: `Ready-made ${req.biome} loaded instantly` })
      return ready
    }
    userWaiting++
    try {
      return await abortable(
        exclusive(() => generateNow({ ...base, seed: defaultSeed(), from: randomSpot() }, progress, signal)),
        signal
      )
    } finally {
      userWaiting--
      void pump()
    }
  } catch (e) {
    progress({ stage: 'error', message: (e as Error).message })
    throw e
  }
}

/** The world's region folder for a dimension, in whichever layout this version writes; null if none yet. */
function findRegionDir(world: string, dimension: Dimension): string | null {
  const dirs = regionDirs(dimension).map((d) => join(world, d))
  return dirs.find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith('.mca'))) ?? null
}

/** Reads region files on demand (looking the folder up again until it exists). */
function regionReader(world: string, dimension: Dimension): RegionSource {
  let dir: string | null = null
  return (rx, rz) => {
    dir ??= findRegionDir(world, dimension)
    const p = dir && join(dir, `r.${rx}.${rz}.mca`)
    return p && existsSync(p) ? new Uint8Array(readFileSync(p)) : null
  }
}

/** Cuts terrain out of an existing singleplayer world save (1.18+). */
export function importWorld(req: WorldImportRequest): TerrainData {
  if (!findRegionDir(req.worldDir, req.dimension))
    throw new Error(`No region files for that dimension in ${req.worldDir}`)
  const cache = new ChunkCache(regionReader(req.worldDir, req.dimension))
  return extractTerrain(cache, {
    centerX: req.centerX,
    centerZ: req.centerZ,
    size: req.size,
    dimension: req.dimension,
    // The Nether has a bedrock roof, so slice around a chosen height instead of following the top.
    focusY: req.centerY ?? (req.dimension === 'the_nether' ? 64 : undefined)
  })
}

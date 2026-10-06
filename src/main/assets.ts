// Locates the user's Minecraft installation and reads block assets straight out of the client jar.
// We never ship Mojang's files: everything is read locally from the user's own copy of the game.
import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { isSupported, locateCommand, releaseTimeOf } from '@shared/minecraft/compat'
import type { AssetBundle, BiomeInfo } from '@shared/types'

const KEEP = [
  'assets/minecraft/blockstates/',
  'assets/minecraft/models/block/',
  'assets/minecraft/models/item/',
  'assets/minecraft/textures/item/',
  // Armor: 1.21.2+ keeps it under textures/entity/equipment; older versions under textures/models/armor.
  'assets/minecraft/textures/models/armor/',
  'assets/minecraft/textures/block/',
  'assets/minecraft/textures/colormap/',
  'assets/minecraft/textures/entity/',
  'assets/minecraft/textures/particle/',
  'assets/minecraft/textures/environment/',
  'assets/minecraft/textures/font/',
  'data/minecraft/worldgen/biome/',
  // Vanilla structure templates (village houses, igloos, shipwrecks…); "structures" before 1.21.
  'data/minecraft/structure/',
  'data/minecraft/structures/'
]

/** Per-user app data folder (Roaming on Windows, Application Support on macOS, ~/.local/share on Linux). */
function appDataDir(): string {
  const home = homedir()
  if (process.platform === 'win32') return process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support')
  return process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
}

/**
 * Folders laid out like .minecraft (versions/<id>/<id>.jar plus libraries/): the official launcher first,
 * then launchers that copy its layout, then versions ThumbCraft downloaded itself.
 */
export function minecraftRoots(): string[] {
  const home = homedir()
  const data = appDataDir()
  const official =
    process.platform === 'win32'
      ? join(data, '.minecraft')
      : process.platform === 'darwin'
        ? join(data, 'minecraft')
        : join(home, '.minecraft')
  return [
    official,
    join(data, 'ModrinthApp', 'meta'),
    join(data, 'com.modrinth.theseus', 'meta'),
    join(home, 'curseforge', 'minecraft', 'Install'),
    join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft'),
    cacheDir('clients')
  ]
}

/** Prism Launcher keeps vanilla client jars as libraries/com/mojang/minecraft/<v>/minecraft-<v>-client.jar. */
function prismRoots(): string[] {
  const home = homedir()
  return [
    join(appDataDir(), 'PrismLauncher'),
    join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher')
  ]
}

/** The game version a jar holds, from its file name (Prism names them minecraft-<v>-client.jar). */
export const versionOfJar = (jarPath: string): string =>
  basename(jarPath)
    .replace(/\.jar$/, '')
    .replace(/^minecraft-(.+)-client$/, '$1')

/** The launcher's version json for a version id (next to the jar, or in any .minecraft folder). */
export function versionJsonPath(id: string, jarPath?: string): string | null {
  const candidates = [
    ...(jarPath ? [join(dirname(jarPath), `${id}.json`)] : []),
    ...minecraftRoots().map((r) => join(r, 'versions', id, `${id}.json`))
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** The vanilla version a profile builds on and its release date (follows inheritsFrom for modded profiles). */
function releaseOf(id: string, jarPath?: string): { base: string; releaseTime?: string } {
  let releaseTime: string | undefined
  let cur: string | undefined = id
  for (let i = 0; i < 4 && cur && !releaseTime; i++) {
    const file = versionJsonPath(cur, i === 0 ? jarPath : undefined)
    if (!file) break
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as { releaseTime?: string; inheritsFrom?: string }
      if (json.inheritsFrom) cur = json.inheritsFrom
      else releaseTime = json.releaseTime
    } catch {
      break
    }
  }
  return { base: cur ?? id, releaseTime }
}

/** Command the generator server uses to find a biome in this version. */
export function locateCommandOf(id: string): 'locate biome' | 'locatebiome' {
  const { base, releaseTime } = releaseOf(id)
  return locateCommand(base, releaseTime)
}

/** Every client jar the launchers on this computer have downloaded. */
function installedJars(): { id: string; jarPath: string }[] {
  const out: { id: string; jarPath: string }[] = []
  for (const root of minecraftRoots()) {
    const dir = join(root, 'versions')
    if (existsSync(dir)) for (const id of readdirSync(dir)) out.push({ id, jarPath: join(dir, id, `${id}.jar`) })
  }
  for (const root of prismRoots()) {
    const dir = join(root, 'libraries', 'com', 'mojang', 'minecraft')
    if (existsSync(dir))
      for (const id of readdirSync(dir)) out.push({ id, jarPath: join(dir, id, `minecraft-${id}-client.jar`) })
  }
  return out.filter((v) => existsSync(v.jarPath))
}

/** Installed jars ThumbCraft can use (1.18+), newest Minecraft version first. */
export function newestJars(): string[] {
  return installedJars()
    .map((v) => {
      const { base, releaseTime } = releaseOf(v.id, v.jarPath)
      const ok = isSupported(base, releaseTime)
      return { ...v, ok, time: releaseTimeOf(base, releaseTime), mtime: statSync(v.jarPath).mtimeMs }
    })
    .filter((v) => v.ok)
    .sort((a, b) => b.time - a.time || b.mtime - a.mtime)
    .map((v) => v.jarPath)
}

/** In-memory copy of the files we need from the currently loaded jar. */
let files: Record<string, Uint8Array> = {}
let loadedVersion = ''
let loadedJar = ''
let obfuscated = false

export function currentVersion(): string {
  return loadedVersion
}

export function currentJar(): string {
  return loadedJar
}

/** Releases before 26.1 ship with obfuscated class names (mapped back with Mojang's official mappings). */
export function isObfuscated(): boolean {
  return obfuscated
}

/** Width/height of every entity texture, read from the PNG headers. */
export function entityTextureSizes(): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  for (const [name, bytes] of Object.entries(files)) {
    const m = /^assets\/minecraft\/textures\/(entity\/.+)\.png$/.exec(name)
    if (!m || bytes.length < 24) continue
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    out[m[1]] = [dv.getUint32(16), dv.getUint32(20)]
  }
  return out
}

export function readAsset(path: string): Uint8Array | undefined {
  return files[`assets/minecraft/${path}`]
}

/** Raw bytes of a vanilla structure template, by id like "village/plains/houses/plains_small_house_1". */
export function readStructure(id: string): Uint8Array | undefined {
  return files[`data/minecraft/structure/${id}.nbt`] ?? files[`data/minecraft/structures/${id}.nbt`]
}

const td = new TextDecoder()
const json = (bytes: Uint8Array): unknown => JSON.parse(td.decode(bytes))

/** Colours appear as ints in older data and as "#rrggbb" strings in newer environment attributes. */
function colour(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v)) return parseInt(v.replace('#', ''), 16)
  if (v && typeof v === 'object' && 'value' in v) return colour((v as { value: unknown }).value)
  return undefined
}

export function normalizeBiome(id: string, raw: Record<string, unknown>): BiomeInfo {
  const effects = (raw.effects ?? {}) as Record<string, unknown>
  const attributes = (raw.attributes ?? {}) as Record<string, unknown>
  const pick = (key: string): number | undefined => {
    if (effects[key] !== undefined) return colour(effects[key])
    const attr = Object.entries(attributes).find(([k]) => k.endsWith(`/${key}`) || k.endsWith(`:${key}`))
    return attr ? colour(attr[1]) : undefined
  }
  return {
    id,
    temperature: Number(raw.temperature ?? 0.5),
    downfall: Number(raw.downfall ?? 0.5),
    effects: {
      sky_color: pick('sky_color'),
      fog_color: pick('fog_color'),
      water_color: pick('water_color'),
      water_fog_color: pick('water_fog_color'),
      grass_color: pick('grass_color'),
      foliage_color: pick('foliage_color'),
      dry_foliage_color: pick('dry_foliage_color'),
      grass_color_modifier: effects.grass_color_modifier as BiomeInfo['effects']['grass_color_modifier']
    }
  }
}

export function loadJar(jarPath: string): AssetBundle {
  let hasMojangNames = false
  const zip = unzipSync(readFileSync(jarPath), {
    filter: (f) => {
      if (f.name === 'net/minecraft/client/model/geom/LayerDefinitions.class') hasMojangNames = true
      if (!KEEP.some((p) => f.name.startsWith(p))) return false
      // Game assets are small; a huge entry means a corrupt or doctored jar (and would be unpacked in memory).
      if (f.originalSize > 64 * 2 ** 20) throw new Error(`${basename(jarPath)} contains an oversized file (${f.name})`)
      return true
    }
  })
  if (!Object.keys(zip).some((k) => k.startsWith('assets/minecraft/blockstates/'))) {
    throw new Error(`${basename(jarPath)} doesn't look like a Minecraft client jar (no blockstates found)`)
  }
  const id = versionOfJar(jarPath)
  const { base, releaseTime } = releaseOf(id, jarPath)
  if (!isSupported(base, releaseTime)) throw new Error(`ThumbCraft needs Minecraft 1.18 or newer (this is ${id}).`)
  files = zip
  loadedVersion = id
  loadedJar = jarPath
  obfuscated = !hasMojangNames

  const blockstates: Record<string, unknown> = {}
  const models: Record<string, unknown> = {}
  const biomes: Record<string, BiomeInfo> = {}
  const textures: string[] = []
  const structures: string[] = []
  for (const [name, bytes] of Object.entries(zip)) {
    let m: RegExpExecArray | null
    if ((m = /^assets\/minecraft\/blockstates\/(.+)\.json$/.exec(name))) blockstates[m[1]] = json(bytes)
    else if ((m = /^assets\/minecraft\/models\/((?:block|item)\/.+)\.json$/.exec(name))) models[m[1]] = json(bytes)
    else if ((m = /^data\/minecraft\/worldgen\/biome\/(.+)\.json$/.exec(name)))
      biomes[m[1]] = normalizeBiome(m[1], json(bytes) as Record<string, unknown>)
    else if ((m = /^assets\/minecraft\/textures\/(.+)\.png$/.exec(name))) textures.push(m[1])
    else if ((m = /^data\/minecraft\/structures?\/(.+)\.nbt$/.exec(name))) structures.push(m[1])
  }
  return {
    version: loadedVersion,
    blockstates,
    models,
    biomes,
    textures,
    structures: structures.sort()
  }
}

/**
 * Java runtimes the official launcher has downloaded (checked alongside the one on PATH).
 * Every Minecraft player already has the launcher's runtime, so no separate Java install is needed.
 */
export function launcherJavaCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  const roots = [...minecraftRoots().map((r) => join(r, 'runtime'))]
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    roots.push(
      join(
        process.env.LOCALAPPDATA,
        'Packages',
        'Microsoft.4297127D64EC6_8wekyb3d8bbwe',
        'LocalCache',
        'Local',
        'runtime'
      )
    )
  }
  // Runtimes ThumbCraft installed itself (see javaInstall.ts).
  roots.push(cacheDir('java'))
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    // The macOS launcher's runtime sits deep: runtime/<c>/mac-os-arm64/<c>/jre.bundle/Contents/Home/bin
    if (depth > 9 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p, depth + 1)
      else if (entry.name === exe && basename(dir) === 'bin') found.push(p)
    }
  }
  roots.forEach((r) => walk(r, 0))
  // A Java the user installed themselves. Only the first `java` on PATH is probed separately, so also look
  // in the standard install folders: a newer Java there may sit behind an older one on PATH.
  if (process.env.JAVA_HOME) {
    const home = join(process.env.JAVA_HOME, 'bin', exe)
    if (existsSync(home)) found.push(home)
  }
  const installDirs =
    process.platform === 'win32'
      ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
          .filter((d): d is string => !!d)
          .flatMap((pf) =>
            ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru'].map((v) =>
              join(pf, v)
            )
          )
      : process.platform === 'darwin'
        ? ['/Library/Java/JavaVirtualMachines', join(homedir(), 'Library', 'Java', 'JavaVirtualMachines')]
        : ['/usr/lib/jvm']
  for (const dir of installDirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const bin of [join(dir, entry.name, 'bin', exe), join(dir, entry.name, 'Contents', 'Home', 'bin', exe)])
        if (existsSync(bin)) found.push(bin)
    }
  }
  return [...new Set(found)]
}

export const cacheDir = (...parts: string[]): string => join(app.getPath('userData'), ...parts)

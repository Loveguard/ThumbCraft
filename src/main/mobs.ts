// Exports the game's own mob models by running tools/model-dumper against the user's client jar.
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { namesFromMappings, type MobModels } from '@shared/minecraft/entityModels'
import { cacheDir, currentJar, currentVersion, entityTextureSizes, isObfuscated, versionJsonPath } from './assets'
import { getBytes, sha1 } from './mojang'
import { findJava } from './generator'

/** A library's file inside <root>/libraries; refuses paths that would leave that folder. */
function libraryFile(root: string, path: string): string {
  const base = join(root, 'libraries')
  const file = join(base, path)
  const rel = relative(base, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Unsafe library path: ${path}`)
  return file
}

interface Library {
  name: string
  downloads?: { artifact?: { path: string; url?: string; sha1?: string } }
  rules?: { action: 'allow' | 'disallow'; os?: { name?: string } }[]
  natives?: unknown
}

interface VersionJson {
  id: string
  inheritsFrom?: string
  libraries?: Library[]
  javaVersion?: { majorVersion: number }
  downloads?: { client_mappings?: { url: string; sha1?: string } }
}

const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'

function allowed(lib: Library): boolean {
  if (!lib.rules) return true
  let ok = false
  for (const r of lib.rules) if (!r.os?.name || r.os.name === osName) ok = r.action === 'allow'
  return ok
}

/** Maven coordinate → relative path, for libraries without an explicit download path. */
function mavenPath(name: string): string {
  const [group, artifact, version, classifier] = name.split(':')
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
}

function readVersion(id: string, jar: string): { json: VersionJson; root: string; libraries: Library[] } {
  const file = versionJsonPath(id, jar)
  if (!file)
    throw new Error(`Couldn't find ${id}.json next to the jar. Load a version from the official launcher folder.`)
  // Launcher layout: <root>/versions/<id>/<id>.json
  const found = { root: dirname(dirname(dirname(file))) }
  const json = JSON.parse(readFileSync(file, 'utf8')) as VersionJson
  let libraries = json.libraries ?? []
  if (json.inheritsFrom) {
    const parent = readVersion(
      json.inheritsFrom,
      join(found.root, 'versions', json.inheritsFrom, `${json.inheritsFrom}.jar`)
    )
    libraries = [...libraries, ...parent.libraries]
    json.javaVersion ??= parent.json.javaVersion
    json.downloads ??= parent.json.downloads
  }
  return { json, root: found.root, libraries }
}

/** Its own package: Mojang's signed jar puts obfuscated classes in the unnamed package. */
const DUMPER_MAIN = 'dev.blockframe.dumper.ModelDumper'
const DUMPER_CLASS_FILE = join('dev', 'blockframe', 'dumper', 'ModelDumper.class')

/** Folder holding ModelDumper.class (packaged: extraResources; dev: the repo's resources/ folder). */
function dumperDir(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'model-dumper')]
    : [join(app.getAppPath(), 'resources'), join(__dirname, '../../resources'), join(process.cwd(), 'resources')]
  const found = candidates.find((d) => existsSync(join(d, DUMPER_CLASS_FILE)))
  if (!found) throw new Error('ModelDumper.class is missing; run "npm run build:dumper"')
  return found
}

async function mappingsFor(id: string, url: string | undefined, want?: string): Promise<string> {
  const file = cacheDir('mappings', `${id}.txt`)
  if (existsSync(file)) return readFileSync(file, 'utf8')
  if (!url) throw new Error(`Minecraft ${id} is obfuscated and Mojang publishes no mappings for it`)
  const bytes = await getBytes(url)
  const text = bytes.toString('utf8')
  if (want && sha1(bytes) !== want) throw new Error("Mojang's mappings download was corrupted; try again")
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return text
}

/** The model exporter while it runs, so quitting the app stops it too. */
const exporters = new Set<ChildProcess>()

/** Kills any running model export (on quit). */
export async function stopMobExport(): Promise<void> {
  exporters.forEach((p) => p.kill())
}

function run(java: string, args: string[], cwd: string, log: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(java, args, { cwd, windowsHide: true })
    exporters.add(p)
    let all = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('Exporting mob models timed out'))
    }, 180_000)
    p.stdout.on('data', (d: Buffer) => {
      all += d.toString()
      log(d.toString())
    })
    p.stderr.on('data', (d: Buffer) => {
      all += d.toString()
      err += d.toString()
      log(d.toString())
    })
    p.on('error', (e) => {
      exporters.delete(p)
      clearTimeout(timer)
      reject(e)
    })
    p.on('exit', (code) => {
      exporters.delete(p)
      clearTimeout(timer)
      const logFile = join(cwd, 'dumper.log')
      try {
        writeFileSync(logFile, all)
      } catch {
        // the log is only a diagnostic
      }
      if (code === 0) return resolve()
      // Prefer the dumper's own ERROR/Caused by lines; otherwise the last lines Java printed.
      const lines = err.trim().split(/\r?\n/)
      const key = lines.filter((l) => /^(ERROR|Caused by|Error|Exception)/.test(l.trim()))
      const summary = (key.length ? key : lines.slice(-4)).slice(0, 4).join('\n')
      reject(new Error(`Mob model export failed (exit ${code}).\n${summary}\nFull log: ${logFile}`))
    })
  })
}

/** Exports in progress, per version (a jar switch mid-export must not get the other version's models). */
const inflight = new Map<string, Promise<MobModels>>()

/** Mob models for the loaded version; exported once, then cached on disk. */
export function loadMobModels(log: (line: string) => void): Promise<MobModels> {
  const version = currentVersion()
  const cached = cacheDir('mobs', `${version}.json`)
  if (existsSync(cached)) {
    const layers = (JSON.parse(readFileSync(cached, 'utf8')) as { layers: MobModels['layers'] }).layers
    return Promise.resolve({ version, layers, textureSizes: entityTextureSizes() })
  }
  const running = inflight.get(version)
  if (running) return running
  const job = (async () => {
    const jar = currentJar()
    const { json, root, libraries } = readVersion(version, jar)
    // The model reader is compiled for Java 17, whatever the game version needs.
    const need = Math.max(17, json.javaVersion?.majorVersion ?? 17)
    const java = await findJava(need)
    if (!java) throw new Error(`Java ${need}+ is required to read mob models`)

    const work = cacheDir('mobs', `${version}-work`)
    mkdirSync(work, { recursive: true })
    const names = isObfuscated()
      ? namesFromMappings(
          await mappingsFor(version, json.downloads?.client_mappings?.url, json.downloads?.client_mappings?.sha1)
        )
      : ''
    writeFileSync(join(work, 'names.properties'), names)

    // Modern versions list LWJGL natives as ordinary classpath jars (classifier "natives-<os>"); LWJGL can
    // load them from the classpath if any model code touches it, so include them. Only the legacy
    // "natives" field style (extracted by the launcher) is skipped.
    const wanted = libraries.filter((l) => allowed(l) && !l.natives)
    // Versions downloaded by ThumbCraft (or copied without the launcher) lack their libraries: fetch them
    // from Mojang like the launcher would.
    const missing = wanted.filter(
      (l) =>
        l.downloads?.artifact?.url &&
        !existsSync(join(root, 'libraries', l.downloads.artifact.path ?? mavenPath(l.name)))
    )
    for (const [i, l] of missing.entries()) {
      const a = l.downloads!.artifact!
      // A version file from a third-party launcher could point anywhere: only hash-checked HTTPS downloads,
      // saved inside the libraries folder.
      if (!a.url!.startsWith('https://') || !a.sha1) throw new Error(`${l.name} has no verifiable download`)
      log(`Downloading game libraries from Mojang (${i + 1} of ${missing.length})…`)
      const bytes = await getBytes(a.url!)
      if (sha1(bytes) !== a.sha1) throw new Error(`${l.name} was corrupted while downloading; try again`)
      const file = libraryFile(root, a.path ?? mavenPath(l.name))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes)
    }
    const libs = wanted
      .map((l) => libraryFile(root, l.downloads?.artifact?.path ?? mavenPath(l.name)))
      .filter((p) => existsSync(p))
    // An argument file keeps long classpaths clear of Windows' command-line limit. Java reads it in the
    // system code page, so paths are made relative to the work folder where possible: a user name like
    // "José" in the absolute path would otherwise break the classpath.
    const cp = [dumperDir(), jar, ...libs]
      .map((p) => {
        const rel = relative(work, p)
        return (isAbsolute(rel) ? p : rel).replace(/\\/g, '/')
      })
      .join(process.platform === 'win32' ? ';' : ':')
    writeFileSync(
      join(work, 'args.txt'),
      `-Djava.awt.headless=true\n-cp\n"${cp}"\n${DUMPER_MAIN}\nnames.properties\nmodels.json\n`
    )

    log(`Exporting mob models from Minecraft ${version} (Java ${java.major})…`)
    await run(java.path, ['@args.txt'], work, log)
    const out = readFileSync(join(work, 'models.json'), 'utf8')
    writeFileSync(cached, out)
    return {
      version,
      layers: (JSON.parse(out) as { layers: MobModels['layers'] }).layers,
      textureSizes: entityTextureSizes()
    }
  })().finally(() => inflight.delete(version))
  inflight.set(version, job)
  return job
}

// Installs a Java runtime for users who have none (or one too old): Eclipse Temurin from the Adoptium API,
// checked against its published SHA-256 and unpacked into the app's own data folder. Nothing system-wide
// is changed; uninstalling ThumbCraft removes it.
import { net } from 'electron'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { readTar, safeRelative } from '@shared/tar'
import { cacheDir } from './assets'
import { getBytes, megabytes } from './mojang'

/** Long-term-support releases, smallest first: the lowest one that's new enough is installed. */
const LTS = [17, 21, 25]

interface AdoptiumAsset {
  binary: { package: { link: string; checksum: string; name: string; size: number } }
  release_name: string
}

const platform = (): { os: string; arch: string } => ({
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
  arch: process.arch === 'arm64' ? 'aarch64' : 'x64'
})

/** Where runtimes installed by ThumbCraft live (searched by findJava). */
export const javaHome = (): string => cacheDir('java')

export async function installJava(minMajor: number, log: (m: string) => void): Promise<void> {
  const major = LTS.find((v) => v >= minMajor) ?? minMajor
  const { os, arch } = platform()
  log(`Looking up Java ${major} for ${os} (${arch})…`)
  const res = await net.fetch(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`
  )
  if (!res.ok) throw new Error(`Couldn't reach Adoptium to download Java (HTTP ${res.status})`)
  const assets = (await res.json()) as AdoptiumAsset[]
  const pkg = assets[0]?.binary.package
  if (!pkg) throw new Error(`Adoptium has no Java ${major} runtime for this computer`)

  const bytes = await getBytes(pkg.link, (done, total) =>
    log(`Downloading Java ${major} (${assets[0].release_name})… ${megabytes(done)} of ${megabytes(total || pkg.size)}`)
  )
  if (createHash('sha256').update(bytes).digest('hex') !== pkg.checksum.toLowerCase())
    throw new Error('The Java download was corrupted (checksum mismatch); try again')

  log(`Unpacking Java ${major}…`)
  const dest = join(javaHome(), String(major))
  const tmp = `${dest}.partial`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  const root = resolve(tmp)
  const target = (rel: string): string => {
    const p = resolve(root, rel)
    if (p !== root && !p.startsWith(root + sep)) throw new Error('Unsafe path in the Java archive')
    return p
  }
  if (pkg.name.endsWith('.zip')) {
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(bytes)))) {
      const rel = safeRelative(name)
      if (!rel || name.endsWith('/')) continue
      const p = target(rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, data)
    }
  } else {
    for (const e of readTar(gunzipSync(bytes))) {
      const rel = safeRelative(e.path)
      if (!rel) continue
      const p = target(rel)
      if (e.type === 'dir') mkdirSync(p, { recursive: true })
      else if (e.type === 'symlink') {
        // Only relative links that stay inside the runtime (macOS bundles link libjli this way).
        if (isAbsolute(e.link)) throw new Error('Unsafe link in the Java archive')
        target(join(dirname(rel), e.link))
        mkdirSync(dirname(p), { recursive: true })
        rmSync(p, { force: true })
        symlinkSync(e.link, p)
      } else {
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, e.data)
        chmodSync(p, e.mode & 0o777 || 0o644)
      }
    }
  }
  rmSync(dest, { recursive: true, force: true })
  renameSync(tmp, dest)
  if (!existsSync(dest)) throw new Error('Java could not be installed')
  log(`Java ${major} is ready`)
}

// Mojang's public endpoints: player profiles/skins and official game downloads.
import { net } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SkinResult } from '@shared/types'

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

async function getJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

export const sha1 = (b: Buffer): string => createHash('sha1').update(b).digest('hex')

/** Nothing the app downloads (game jars, Java, libraries) comes near this; a larger response is cut off. */
const MAX_DOWNLOAD = 1024 * 2 ** 20

/** Downloads a file, optionally reporting "x of y MB" for downloads big enough to make the user wait. */
export async function getBytes(url: string, report: (done: number, total: number) => void = () => {}): Promise<Buffer> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const parts: Uint8Array[] = []
  let done = 0
  let last = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    parts.push(value)
    done += value.length
    if (done > MAX_DOWNLOAD) {
      void reader.cancel()
      throw new Error(`${url} is unexpectedly large; download stopped`)
    }
    if (done - last > 512 * 1024) {
      last = done
      report(done, total)
    }
  }
  report(done, total)
  return Buffer.concat(parts)
}

export const megabytes = (n: number): string => `${(n / 2 ** 20).toFixed(1)} MB`

const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`

export async function fetchSkin(username: string): Promise<SkinResult> {
  const name = username.trim()
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) throw new Error('Minecraft usernames are 1–16 letters, digits or underscores')
  const profileRes = await net.fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`)
  if (profileRes.status === 204 || profileRes.status === 404) throw new Error(`No Minecraft account named "${name}"`)
  if (!profileRes.ok) throw new Error(`Mojang profile lookup failed (HTTP ${profileRes.status})`)
  const profile = (await profileRes.json()) as { id: string; name: string }

  const session = await getJson<{ properties: { name: string; value: string }[] }>(
    `https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`
  )
  const texturesProp = session.properties.find((p) => p.name === 'textures')
  if (!texturesProp) throw new Error('Profile has no textures')
  const textures = JSON.parse(Buffer.from(texturesProp.value, 'base64').toString('utf8')) as {
    textures: { SKIN?: { url: string; metadata?: { model?: string } }; CAPE?: { url: string } }
  }
  const skin = textures.textures.SKIN
  if (!skin) throw new Error(`${profile.name} uses a default skin`)
  const https = (u: string): string => u.replace(/^http:/, 'https:')
  return {
    username: profile.name,
    uuid: profile.id,
    model: skin.metadata?.model === 'slim' ? 'slim' : 'classic',
    skinDataUrl: dataUrl(await getBytes(https(skin.url))),
    capeDataUrl: textures.textures.CAPE ? dataUrl(await getBytes(https(textures.textures.CAPE.url))) : undefined
  }
}

interface VersionJson {
  downloads: Record<string, { url: string; sha1: string; size?: number }>
  javaVersion?: { majorVersion: number; component: string }
}

export async function versionJson(versionId: string): Promise<VersionJson> {
  const manifest = await getJson<{ versions: { id: string; url: string }[] }>(MANIFEST)
  const entry = manifest.versions.find((v) => v.id === versionId)
  if (!entry)
    throw new Error(`Mojang has no download for version "${versionId}" (modded or custom versions need a vanilla id)`)
  return getJson<VersionJson>(entry.url)
}

/** Downloads (once) and verifies the official dedicated server jar for a version. */
export async function ensureServerJar(versionId: string, dest: string, log: (m: string) => void): Promise<VersionJson> {
  // Works offline once downloaded: the version json is kept beside the jar and the jar re-verified against it.
  const saved = `${dest}.version.json`
  if (existsSync(dest) && existsSync(saved)) {
    try {
      const vj = JSON.parse(readFileSync(saved, 'utf8')) as VersionJson
      const want = vj.downloads?.server?.sha1
      if (want && sha1(readFileSync(dest)) === want) return vj
    } catch {
      // re-fetch below
    }
  }
  const vj = await versionJson(versionId)
  const dl = vj.downloads.server
  if (!dl) throw new Error(`Version ${versionId} has no official server download`)
  const keep = (): VersionJson => (writeFileSync(saved, JSON.stringify(vj)), vj)
  if (existsSync(dest) && sha1(readFileSync(dest)) === dl.sha1) return keep()
  log(`Downloading official Minecraft ${versionId} server from Mojang…`)
  const bytes = await getBytes(dl.url)
  if (sha1(bytes) !== dl.sha1) throw new Error('Server jar checksum mismatch')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, bytes)
  return keep()
}

/**
 * Downloads (once) the latest official client jar and its version json from Mojang, laid out like a launcher
 * folder (clients/versions/<id>/<id>.jar) so everything else finds it. Returns the jar path.
 */
export async function downloadLatestClient(clientsRoot: string, log: (m: string) => void): Promise<string> {
  const manifest = await getJson<{ latest: { release: string } }>(MANIFEST)
  const versionId = manifest.latest.release
  if (!/^[\w.\-]{1,64}$/.test(versionId)) throw new Error('Mojang listed an invalid version')
  const vj = await versionJson(versionId)
  const dl = vj.downloads.client
  if (!dl) throw new Error(`Mojang has no client download for ${versionId}`)
  const dir = join(clientsRoot, 'versions', versionId)
  const jar = join(dir, `${versionId}.jar`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${versionId}.json`), JSON.stringify(vj))
  if (existsSync(jar) && sha1(readFileSync(jar)) === dl.sha1) return jar
  const bytes = await getBytes(dl.url, (done, total) =>
    log(`Downloading Minecraft ${versionId} from Mojang… ${megabytes(done)}${total ? ` of ${megabytes(total)}` : ''}`)
  )
  if (sha1(bytes) !== dl.sha1) throw new Error('The download was corrupted (checksum mismatch); try again')
  writeFileSync(jar, bytes)
  return jar
}

// Resource packs, stacked over the loaded jar's files the way Minecraft does it: the top pack wins, then the
// next one, then vanilla. The list (top first) is an app setting, like the game's own pack screen.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { unzipSync } from 'fflate'
import type { ResourcePackInfo } from '@shared/api'
import { readSettings, updateSettings } from './settings'

/** What a pack may replace: block/item models and states, and textures (blocks, mobs, sky, font…). */
const PACK_FILES = /^assets\/minecraft\/(blockstates\/.+\.json|models\/(block|item)\/.+\.json|textures\/.+\.png)$/
const MAX_ENTRY = 64 * 2 ** 20

interface PackSetting {
  path: string
  enabled: boolean
}

export function packSettings(): PackSetting[] {
  return (readSettings().resourcePacks ?? []).filter((p) => typeof p?.path === 'string')
}

export function savePackSettings(list: PackSetting[]): void {
  updateSettings({ resourcePacks: list.map((p) => ({ path: String(p.path), enabled: !!p.enabled })) })
}

/** Every file of a pack (zip or folder) under assets/minecraft, plus its pack.mcmeta and pack.png. */
function readPack(path: string): Record<string, Uint8Array> {
  if (statSync(path).isDirectory()) {
    const out: Record<string, Uint8Array> = {}
    const walk = (dir: string, depth: number): void => {
      if (depth > 12) return
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else {
          const name = relative(path, p).split(sep).join('/')
          if ((PACK_FILES.test(name) || name === 'pack.mcmeta' || name === 'pack.png') && statSync(p).size < MAX_ENTRY)
            out[name] = new Uint8Array(readFileSync(p))
        }
      }
    }
    walk(path, 0)
    return out
  }
  let prefix = ''
  const zip = unzipSync(readFileSync(path), {
    filter: (f) => {
      // Some packs are zipped with their folder inside: "MyPack/assets/minecraft/…".
      const m = /^(.*?)(pack\.mcmeta|pack\.png|assets\/minecraft\/.+)$/.exec(f.name)
      if (!m || f.originalSize > MAX_ENTRY) return false
      if (m[2] === 'pack.mcmeta' && !m[1].includes('/assets/')) prefix = m[1]
      return true
    }
  })
  const out: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(zip)) {
    const inner = name.startsWith(prefix) ? name.slice(prefix.length) : name
    if (PACK_FILES.test(inner) || inner === 'pack.mcmeta' || inner === 'pack.png') out[inner] = bytes
  }
  return out
}

const td = new TextDecoder()

/** The pack's description from pack.mcmeta (plain text or a text component). */
function description(meta: Uint8Array | undefined): string {
  if (!meta) return ''
  try {
    const d = (JSON.parse(td.decode(meta).replace(/^﻿/, '')) as { pack?: { description?: unknown } }).pack?.description
    const text = (v: unknown): string =>
      typeof v === 'string'
        ? v
        : Array.isArray(v)
          ? v.map(text).join('')
          : v && typeof v === 'object'
            ? `${text((v as { text?: unknown }).text ?? '')}${text((v as { extra?: unknown }).extra ?? '')}`
            : ''
    return text(d).replace(/§./g, '').trim()
  } catch {
    return ''
  }
}

const cache = new Map<string, { mtime: number; files: Record<string, Uint8Array> }>()

function packFiles(path: string): Record<string, Uint8Array> {
  const mtime = statSync(path).mtimeMs
  const hit = cache.get(path)
  if (hit && hit.mtime === mtime) return hit.files
  const files = readPack(path)
  cache.set(path, { mtime, files })
  return files
}

/** The pack list for the Look tab, with names, descriptions and icons; missing packs are marked. */
export function listPacks(): ResourcePackInfo[] {
  return packSettings().map(({ path, enabled }) => {
    const name = basename(path).replace(/\.zip$/i, '')
    if (!existsSync(path)) return { path, enabled, name, description: '', icon: null, missing: true, textures: 0 }
    try {
      const files = packFiles(path)
      const icon = files['pack.png']
        ? `data:image/png;base64,${Buffer.from(files['pack.png']).toString('base64')}`
        : null
      const textures = Object.keys(files).filter((k) => k.endsWith('.png') && k !== 'pack.png').length
      return { path, enabled, name, description: description(files['pack.mcmeta']), icon, missing: false, textures }
    } catch (e) {
      return { path, enabled, name, description: (e as Error).message, icon: null, missing: true, textures: 0 }
    }
  })
}

/** Checks that a file or folder is a resource pack; throws with a readable reason when not. */
export function checkPack(path: string): void {
  const files = readPack(path)
  if (!Object.keys(files).some((k) => PACK_FILES.test(k)))
    throw new Error(
      `${basename(path)} has no Minecraft textures or models (assets/minecraft/…), so it isn't a resource pack`
    )
}

/** `base` with every enabled pack laid over it, bottom pack first so the top one wins. */
export function withPacks(base: Record<string, Uint8Array>): { files: Record<string, Uint8Array>; applied: string[] } {
  const enabled = packSettings().filter((p) => p.enabled && existsSync(p.path))
  if (!enabled.length) return { files: base, applied: [] }
  const files = { ...base }
  const applied: string[] = []
  for (const p of [...enabled].reverse()) {
    try {
      for (const [name, bytes] of Object.entries(packFiles(p.path))) if (PACK_FILES.test(name)) files[name] = bytes
      applied.unshift(basename(p.path).replace(/\.zip$/i, ''))
    } catch {
      // unreadable pack: skipped (the list shows it)
    }
  }
  return { files, applied }
}

// Project files on disk: explicit saves (.bfproj anywhere the user chooses) plus automatic recovery
// copies in the app's data folder, which back the "Recent projects" list.
import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ProjectMeta, RecentProject } from '@shared/api'

const dir = (): string => {
  const d = join(app.getPath('userData'), 'projects')
  mkdirSync(d, { recursive: true })
  return d
}
const indexFile = (): string => join(dir(), 'recent.json')
/** File name for a project id; anything unusual is hashed so two ids can never share a file. */
const safeId = (id: string): string =>
  /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : createHash('sha1').update(id).digest('hex')

/** Decodes a PNG data URL, refusing anything else. */
export function pngBytes(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl)
  if (!m) throw new Error('Expected a PNG image')
  return Buffer.from(m[1], 'base64')
}

/** Decodes an exported image (PNG or JPG data URL) and the file extension it should be saved with. */
export function imageBytes(dataUrl: string): { bytes: Buffer; ext: 'png' | 'jpg' } {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(dataUrl)
  if (!m) throw new Error('Expected a PNG or JPG image')
  return { bytes: Buffer.from(m[2], 'base64'), ext: m[1] === 'png' ? 'png' : 'jpg' }
}

/**
 * Paths the user picked in a save/open dialog this session. Only these (or ones already in the recent list,
 * which got there the same way) are ever written or read on the renderer's behalf.
 */
const approved = new Set<string>()
const isApproved = (p: string | null | undefined): p is string =>
  !!p && (approved.has(p) || readIndex().some((e) => e.savedPath === p))

interface IndexEntry {
  id: string
  name: string
  savedPath: string | null
  updatedAt: number
  minecraftVersion: string | null
}

function readIndex(): IndexEntry[] {
  try {
    return JSON.parse(readFileSync(indexFile(), 'utf8')) as IndexEntry[]
  } catch {
    return []
  }
}

function writeIndex(entries: IndexEntry[]): void {
  writeAtomic(indexFile(), new TextEncoder().encode(JSON.stringify(entries.slice(0, 40), null, 2)))
}

/** Writes atomically (temp file + rename) so a crash mid-save never corrupts the previous copy. */
export function writeAtomic(path: string, bytes: Uint8Array): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, bytes)
  renameSync(tmp, path)
}

function touch(entry: Omit<IndexEntry, 'updatedAt'>): void {
  const others = readIndex().filter((e) => e.id !== entry.id)
  writeIndex([{ ...entry, updatedAt: Date.now() }, ...others])
}

export function autosave(bytes: Uint8Array, meta: ProjectMeta): void {
  const id = safeId(meta.id)
  writeAtomic(join(dir(), `${id}.bfproj`), bytes)
  if (meta.thumbnail?.startsWith('data:image/png;base64,'))
    writeAtomic(join(dir(), `${id}.png`), pngBytes(meta.thumbnail))
  // Never trust a path from the renderer: keep the one we already know unless the user picked this one.
  const known = readIndex().find((e) => e.id === meta.id)?.savedPath ?? null
  const savedPath = isApproved(meta.savedPath) ? meta.savedPath : known
  touch({ id: meta.id, name: meta.name, savedPath, minecraftVersion: meta.minecraftVersion })
}

export function recentProjects(): RecentProject[] {
  return readIndex()
    .filter((e) => existsSync(join(dir(), `${safeId(e.id)}.bfproj`)) || (e.savedPath && existsSync(e.savedPath)))
    .map((e) => {
      const png = join(dir(), `${safeId(e.id)}.png`)
      return {
        ...e,
        thumbnail: existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : null
      }
    })
}

/** The newest copy of a recent project: the autosave, unless the saved file was modified later. */
export function readRecent(id: string): { bytes: Uint8Array; path: string | null } {
  const entry = readIndex().find((e) => e.id === id)
  const auto = join(dir(), `${safeId(id)}.bfproj`)
  const saved = entry?.savedPath && existsSync(entry.savedPath) ? entry.savedPath : null
  const autoTime = existsSync(auto) ? statSync(auto).mtimeMs : -1
  const savedTime = saved ? statSync(saved).mtimeMs : -1
  const file = savedTime > autoTime ? saved! : auto
  if (!existsSync(file)) throw new Error('That project no longer exists')
  return { bytes: new Uint8Array(readFileSync(file)), path: saved }
}

export function forgetRecent(id: string): void {
  writeIndex(readIndex().filter((e) => e.id !== id))
  for (const ext of ['bfproj', 'png']) rmSync(join(dir(), `${safeId(id)}.${ext}`), { force: true })
}

export async function saveProject(
  win: BrowserWindow,
  bytes: Uint8Array,
  path: string | null,
  meta: ProjectMeta
): Promise<string | null> {
  let target = isApproved(path) ? path : null
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save project',
      defaultPath: `${meta.name.replace(/[\\/:*?"<>|]/g, '_') || 'thumbnail'}.bfproj`,
      filters: [{ name: 'ThumbCraft project', extensions: ['bfproj'] }]
    })
    if (r.canceled || !r.filePath) return null
    target = r.filePath
    approved.add(target)
  }
  writeAtomic(target, bytes)
  autosave(bytes, { ...meta, savedPath: target })
  return target
}

export async function openProjectDialog(win: BrowserWindow): Promise<{ bytes: Uint8Array; path: string } | null> {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open project',
    filters: [{ name: 'ThumbCraft project', extensions: ['bfproj'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return null
  approved.add(r.filePaths[0])
  return { bytes: new Uint8Array(readFileSync(r.filePaths[0])), path: r.filePaths[0] }
}

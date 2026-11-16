// Fonts installed on this computer, for title text. Only each file's name table is read while listing;
// a font's bytes are read when it is picked (the renderer then embeds them in the project).
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { extractFont, fontName, fontOffsets, type ByteReader } from '@shared/fontFiles'
import type { SystemFont } from '@shared/api'

function fontDirs(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const win = process.env.WINDIR ?? 'C:\\Windows'
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [join(win, 'Fonts'), join(local, 'Microsoft', 'Windows', 'Fonts')]
  }
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(home, 'Library', 'Fonts')]
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.local', 'share', 'fonts'), join(home, '.fonts')]
}

const EXT = new Set(['.ttf', '.otf', '.ttc'])

function walk(dir: string, depth: number, out: string[]): void {
  if (depth > 4 || !existsSync(dir)) return
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1, out)
      else if (EXT.has(extname(e.name).toLowerCase())) out.push(p)
    }
  } catch {
    // unreadable folder
  }
}

function readerFor(fd: number, size: number): ByteReader {
  return (offset, length) => {
    const len = Math.max(0, Math.min(length, size - offset))
    const buf = Buffer.alloc(len)
    if (len) readSync(fd, buf, 0, len, offset)
    return new DataView(buf.buffer, buf.byteOffset, len)
  }
}

let listed: SystemFont[] | null = null

/** Every installed font (each face of a collection separately), sorted by name. Listed once per app run. */
export function listSystemFonts(): SystemFont[] {
  if (listed) return listed
  const files: string[] = []
  for (const d of fontDirs()) walk(d, 0, files)
  const seen = new Set<string>()
  const out: SystemFont[] = []
  for (const path of files) {
    let fd = -1
    try {
      fd = openSync(path, 'r')
      const size = statSync(path).size
      const read = readerFor(fd, size)
      const head = read(0, 12 + 64 * 4)
      const offsets = fontOffsets(new Uint8Array(head.buffer, head.byteOffset, head.byteLength))
      offsets.forEach((offset, index) => {
        const n = fontName(read, offset)
        if (!n || seen.has(n.full) || n.family.startsWith('.')) return
        seen.add(n.full)
        out.push({ ...n, path, index })
      })
    } catch {
      // not a readable font
    } finally {
      if (fd >= 0) closeSync(fd)
    }
  }
  listed = out.sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style))
  return listed
}

/** A listed font's bytes as a standalone .ttf/.otf (a collection's face is extracted). */
export function readSystemFont(path: string, index: number): Uint8Array {
  // Only files the list itself found, so the renderer can't read arbitrary files through this.
  const font = listSystemFonts().find((f) => f.path === path && f.index === index)
  if (!font) throw new Error('That font is no longer installed')
  const bytes = new Uint8Array(readFileSync(path))
  return extractFont(bytes, fontOffsets(bytes)[index] ?? 0)
}

// A minimal tar reader (ustar, GNU long names, pax paths) for unpacking Java runtimes on macOS and Linux.

export interface TarEntry {
  path: string
  type: 'file' | 'dir' | 'symlink'
  mode: number
  data: Uint8Array
  /** Symlink target. */
  link: string
}

const text = (b: Uint8Array, start: number, len: number): string => {
  let end = start
  while (end < start + len && b[end] !== 0) end++
  return new TextDecoder().decode(b.subarray(start, end))
}
const octal = (b: Uint8Array, start: number, len: number): number => parseInt(text(b, start, len).trim() || '0', 8)

/** Rejects absolute paths and ".." so an archive can never write outside the folder it unpacks into. */
export function safeRelative(path: string): string | null {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.')
  if (/^([a-zA-Z]:|\/)/.test(path) || parts.some((p) => p === '..')) return null
  return parts.join('/')
}

export function readTar(tar: Uint8Array): TarEntry[] {
  const out: TarEntry[] = []
  let longName: string | null = null
  let paxPath: string | null = null
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512)
    if (h.every((x) => x === 0)) break
    const size = octal(h, 124, 12)
    const flag = String.fromCharCode(h[156] || 48)
    const body = tar.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
    if (flag === 'L') {
      longName = text(body, 0, body.length)
      continue
    }
    if (flag === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(body))
      paxPath = m ? m[1] : null
      continue
    }
    if (flag === 'g') continue
    const prefix = text(h, 345, 155)
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100))
    longName = paxPath = null
    const type = flag === '5' ? 'dir' : flag === '2' ? 'symlink' : flag === '0' || flag === '7' ? 'file' : null
    if (!type) continue // hard links, devices, fifos: never in a Java runtime
    out.push({ path: name, type, mode: octal(h, 100, 8), data: body, link: text(h, 157, 100) })
  }
  return out
}

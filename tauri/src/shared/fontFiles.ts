// Reads the names inside TrueType/OpenType font files (and collections), for the system font list.

export interface FontName {
  /** Family, e.g. "Arial" (the typographic family when the font has one). */
  family: string
  /** Style within the family, e.g. "Bold Italic". */
  style: string
  /** Full name, e.g. "Arial Bold Italic". */
  full: string
}

const SFNT = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */])
const TTCF = 0x74746366

/** Offsets of each font in a file: one for a .ttf/.otf, several for a .ttc collection; empty if not a font. */
export function fontOffsets(bytes: Uint8Array): number[] {
  if (bytes.length < 12) return []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = dv.getUint32(0)
  if (SFNT.has(tag)) return [0]
  if (tag !== TTCF) return []
  const n = Math.min(dv.getUint32(8), 64)
  const out: number[] = []
  for (let i = 0; i < n && 12 + i * 4 + 4 <= bytes.length; i++) out.push(dv.getUint32(12 + i * 4))
  return out
}

/** Reads `length` bytes at `offset` of a font file (lets the main process read only the parts it needs). */
export type ByteReader = (offset: number, length: number) => DataView

export const bytesReader =
  (bytes: Uint8Array): ByteReader =>
  (offset, length) =>
    new DataView(bytes.buffer, bytes.byteOffset + offset, Math.max(0, Math.min(length, bytes.length - offset)))

function tables(read: ByteReader, at: number): Map<string, { offset: number; length: number }> {
  const out = new Map<string, { offset: number; length: number }>()
  const count = read(at + 4, 2).getUint16(0)
  const dir = read(at + 12, count * 16)
  for (let i = 0; i < count && i * 16 + 16 <= dir.byteLength; i++) {
    const r = i * 16
    const tag = String.fromCharCode(dir.getUint8(r), dir.getUint8(r + 1), dir.getUint8(r + 2), dir.getUint8(r + 3))
    out.set(tag, { offset: dir.getUint32(r + 8), length: dir.getUint32(r + 12) })
  }
  return out
}

/** The names of the font at `offset` (see fontOffsets), or null when it has no usable name table. */
export function fontName(source: Uint8Array | ByteReader, offset = 0): FontName | null {
  try {
    const read = typeof source === 'function' ? source : bytesReader(source)
    const table = tables(read, offset).get('name')
    if (!table || table.length > 1 << 20) return null
    const dv = read(table.offset, table.length)
    const count = dv.getUint16(2)
    const strings = dv.getUint16(4)
    // Best record per name id: Windows English Unicode, then any Windows Unicode, then Mac Roman.
    const best = new Map<number, { score: number; text: string }>()
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12
      const platform = dv.getUint16(r)
      const encoding = dv.getUint16(r + 2)
      const lang = dv.getUint16(r + 4)
      const id = dv.getUint16(r + 6)
      if (![1, 2, 4, 16, 17].includes(id)) continue
      const len = dv.getUint16(r + 8)
      const at = strings + dv.getUint16(r + 10)
      if (at + len > dv.byteLength) continue
      let text = ''
      let score = 0
      if (platform === 3 && (encoding === 1 || encoding === 10)) {
        for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(dv.getUint16(at + k))
        score = lang === 0x409 ? 3 : 2
      } else if (platform === 0) {
        for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(dv.getUint16(at + k))
        score = 2
      } else if (platform === 1 && encoding === 0) {
        for (let k = 0; k < len; k++) text += String.fromCharCode(dv.getUint8(at + k))
        score = 1
      } else continue
      text = text.replace(/\0/g, '').trim()
      if (text && (best.get(id)?.score ?? -1) < score) best.set(id, { score, text })
    }
    const get = (id: number): string | undefined => best.get(id)?.text
    const family = get(16) ?? get(1)
    if (!family) return null
    const style = get(17) ?? get(2) ?? 'Regular'
    const full = get(4) ?? (style === 'Regular' ? family : `${family} ${style}`)
    return { family, style, full }
  } catch {
    return null
  }
}

/**
 * One font of a collection as a standalone .ttf/.otf (browsers can't load a .ttc as a web font).
 * Fonts in a collection share tables, so each table is copied out and the directory rewritten.
 */
export function extractFont(bytes: Uint8Array, offset: number): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (offset === 0 && SFNT.has(dv.getUint32(0))) return bytes
  const count = dv.getUint16(offset + 4)
  const records: { rec: Uint8Array; offset: number; length: number }[] = []
  for (let i = 0; i < count; i++) {
    const r = offset + 12 + i * 16
    records.push({ rec: bytes.slice(r, r + 16), offset: dv.getUint32(r + 8), length: dv.getUint32(r + 12) })
  }
  const pad = (n: number): number => (n + 3) & ~3
  const head = 12 + count * 16
  const total = records.reduce((sum, t) => sum + pad(t.length), head)
  const out = new Uint8Array(total)
  const odv = new DataView(out.buffer)
  out.set(bytes.slice(offset, offset + 12), 0)
  let at = head
  records.forEach((t, i) => {
    out.set(t.rec, 12 + i * 16)
    odv.setUint32(12 + i * 16 + 8, at)
    out.set(bytes.subarray(t.offset, t.offset + t.length), at)
    at += pad(t.length)
  })
  return out
}

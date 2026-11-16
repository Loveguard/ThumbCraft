import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractFont, fontName, fontOffsets } from '../src/shared/fontFiles'

/** A minimal TrueType file holding only a name table. */
function fakeFont(names: Record<number, string>): Uint8Array {
  const ids = Object.keys(names).map(Number)
  const strings = ids.map((id) => {
    const s = names[id]
    const b = new Uint8Array(s.length * 2)
    for (let i = 0; i < s.length; i++) b[i * 2 + 1] = s.charCodeAt(i)
    return b
  })
  const nameLen = 6 + ids.length * 12 + strings.reduce((n, s) => n + s.length, 0)
  const out = new Uint8Array(12 + 16 + nameLen)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x00010000)
  dv.setUint16(4, 1)
  out.set([110, 97, 109, 101], 12) // "name"
  dv.setUint32(12 + 8, 28)
  dv.setUint32(12 + 12, nameLen)
  dv.setUint16(28 + 2, ids.length)
  dv.setUint16(28 + 4, 6 + ids.length * 12)
  let at = 0
  ids.forEach((id, i) => {
    const r = 28 + 6 + i * 12
    dv.setUint16(r, 3)
    dv.setUint16(r + 2, 1)
    dv.setUint16(r + 4, 0x409)
    dv.setUint16(r + 6, id)
    dv.setUint16(r + 8, strings[i].length)
    dv.setUint16(r + 10, at)
    out.set(strings[i], 28 + 6 + ids.length * 12 + at)
    at += strings[i].length
  })
  return out
}

describe('font names', () => {
  it('reads family, style and full name', () => {
    const f = fakeFont({ 1: 'Arial', 2: 'Bold', 4: 'Arial Bold' })
    expect(fontOffsets(f)).toEqual([0])
    expect(fontName(f)).toEqual({ family: 'Arial', style: 'Bold', full: 'Arial Bold' })
  })

  it('prefers the typographic family', () => {
    const f = fakeFont({ 1: 'Segoe UI Black', 2: 'Regular', 16: 'Segoe UI', 17: 'Black' })
    expect(fontName(f)).toMatchObject({ family: 'Segoe UI', style: 'Black', full: 'Segoe UI Black' })
  })

  it('ignores files that are not fonts', () => {
    expect(fontOffsets(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toEqual([])
  })

  it('splits a font out of a collection', () => {
    const a = fakeFont({ 1: 'Alpha', 2: 'Regular' })
    // A .ttc header pointing at one font placed after it (its table offsets are absolute in the collection).
    const ttc = new Uint8Array(16 + a.length)
    const dv = new DataView(ttc.buffer)
    dv.setUint32(0, 0x74746366)
    dv.setUint32(4, 0x00010000)
    dv.setUint32(8, 1)
    dv.setUint32(12, 16)
    ttc.set(a, 16)
    new DataView(ttc.buffer).setUint32(16 + 12 + 8, 28 + 16)
    expect(fontOffsets(ttc)).toEqual([16])
    expect(fontName(ttc, 16)?.family).toBe('Alpha')
    const single = extractFont(ttc, 16)
    expect(fontOffsets(single)).toEqual([0])
    expect(fontName(single)?.family).toBe('Alpha')
  })

  it('reads real installed fonts when there are any', () => {
    const dir = '/usr/share/fonts/truetype/dejavu'
    if (!existsSync(dir)) return
    const file = readdirSync(dir).find((f) => f.endsWith('.ttf'))
    if (!file) return
    const n = fontName(new Uint8Array(readFileSync(join(dir, file))))
    expect(n?.family).toMatch(/DejaVu/)
  })
})

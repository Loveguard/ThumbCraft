import { describe, expect, it } from 'vitest'
import { gzipSync, zlibSync } from 'fflate'
import { NBT_TAG, writeNbt, type NbtTyped } from './nbtWriter'
import {
  gunzipCapped,
  parseBlockString,
  readSchematic,
  searchStructures,
  unpackSpanning
} from '@shared/minecraft/schematics'
import { unzlibCapped } from '@shared/minecraft/inflate'
import type { TerrainData } from '@shared/types'

const S = (value: string): NbtTyped => ({ type: 'string', value })
const I = (value: number): NbtTyped => ({ type: 'int', value })
const list = (value: NbtTyped[], itemType: number = NBT_TAG.compound): NbtTyped => ({ type: 'list', itemType, value })
const comp = (value: Record<string, NbtTyped>): NbtTyped => ({ type: 'compound', value })
const at = (t: TerrainData, x: number, y: number, z: number): string => {
  const b = t.palette[t.blocks[x + z * t.sizeX + y * t.sizeX * t.sizeZ]]
  const props = Object.entries(b.properties)
  return props.length ? `${b.name}[${props.map(([k, v]) => `${k}=${v}`).join(',')}]` : b.name
}

describe('schematics', () => {
  it('parses block state strings', () => {
    expect(parseBlockString('minecraft:oak_stairs[facing=east,half=bottom]')).toEqual({
      name: 'minecraft:oak_stairs',
      properties: { facing: 'east', half: 'bottom' }
    })
    expect(parseBlockString('stone').name).toBe('minecraft:stone')
  })

  it('reads vanilla structure templates, resolving jigsaw final states', () => {
    const nbt = writeNbt({
      size: list([I(2), I(1), I(1)], 3),
      palette: list([
        comp({ Name: S('minecraft:cobblestone') }),
        comp({ Name: S('minecraft:jigsaw'), Properties: comp({ orientation: S('north_up') }) }),
        comp({ Name: S('minecraft:structure_void') })
      ]),
      blocks: list([
        comp({ state: I(0), pos: list([I(0), I(0), I(0)], 3) }),
        comp({ state: I(1), pos: list([I(1), I(0), I(0)], 3), nbt: comp({ final_state: S('minecraft:oak_planks') }) })
      ])
    })
    const t = readSchematic(gzipSync(nbt), 'house.nbt')
    expect([t.sizeX, t.sizeY, t.sizeZ]).toEqual([2, 1, 1])
    expect(at(t, 0, 0, 0)).toBe('minecraft:cobblestone')
    expect(at(t, 1, 0, 0)).toBe('minecraft:oak_planks')
    expect(t.palette.some((p) => p.name === 'minecraft:structure_void')).toBe(false)
  })

  it('reads Sponge v2 schematics (varint block data)', () => {
    // 200 palette entries forces 2-byte varints.
    const palette: Record<string, NbtTyped> = { 'minecraft:air': I(0) }
    for (let i = 1; i < 200; i++) palette[`minecraft:wool_${i}`] = I(i)
    const data = [5, 199, 0, 130] // 199 and 130 need two bytes
    const bytes: number[] = []
    for (let v of data) {
      while (v >= 0x80) {
        bytes.push((v & 0x7f) | 0x80)
        v >>= 7
      }
      bytes.push(v)
    }
    const blockData = Int8Array.from(bytes.map((b) => (b > 127 ? b - 256 : b)))
    const dims = {
      Width: { type: 'short', value: 2 },
      Height: { type: 'short', value: 2 },
      Length: { type: 'short', value: 1 }
    } as const
    const v2 = writeNbtWithByteArray({ ...dims, Version: I(2), Palette: comp(palette) }, 'BlockData', blockData)
    const t2 = readSchematic(v2, 'a.schem')
    expect(at(t2, 0, 0, 0)).toBe('minecraft:wool_5')
    expect(at(t2, 1, 0, 0)).toBe('minecraft:wool_199')
    expect(at(t2, 1, 1, 0)).toBe('minecraft:wool_130')
  })

  it('unpacks Litematica values that span two longs', () => {
    // 3 bits per value; value index 21 spans bits 63..65.
    const values = Array.from({ length: 30 }, (_, i) => (i * 5) % 8)
    let big = 0n
    values.forEach((v, i) => (big |= BigInt(v) << BigInt(i * 3)))
    const longs = BigInt64Array.from([BigInt.asIntN(64, big & ((1n << 64n) - 1n)), BigInt.asIntN(64, big >> 64n)])
    expect(Array.from(unpackSpanning(longs, 3, 30))).toEqual(values)
  })

  it('searches structure ids by tag words', () => {
    const ids = [
      'village/plains/houses/plains_small_house_1',
      'village/desert/houses/desert_small_house_2',
      'village/plains/houses/plains_butcher_shop_1',
      'igloo/top',
      'shipwreck/rightsideup_full'
    ]
    expect(searchStructures(ids, 'plains house')).toEqual([
      'village/plains/houses/plains_small_house_1',
      'village/plains/houses/plains_butcher_shop_1'
    ])
    expect(searchStructures(ids, 'ship')).toEqual(['shipwreck/rightsideup_full'])
    expect(searchStructures(ids, 'igloos')).toEqual(['igloo/top'])
  })
})

/** writeNbt + a TAG_Byte_Array field (the writer only needs it for this test). */
function writeNbtWithByteArray(root: Record<string, NbtTyped>, key: string, arr: Int8Array): Uint8Array {
  const base = writeNbt(root)
  const name = new TextEncoder().encode(key)
  const extra = new Uint8Array(1 + 2 + name.length + 4 + arr.length)
  const dv = new DataView(extra.buffer)
  extra[0] = 7
  dv.setUint16(1, name.length)
  extra.set(name, 3)
  dv.setInt32(3 + name.length, arr.length)
  extra.set(new Uint8Array(arr.buffer), 7 + name.length)
  // Insert before the root compound's closing TAG_End.
  const out = new Uint8Array(base.length + extra.length)
  out.set(base.subarray(0, base.length - 1))
  out.set(extra, base.length - 1)
  out[out.length - 1] = 0
  return out
}

describe('corrupt input', () => {
  it('rejects truncated or lying NBT with a clear error', async () => {
    const { parseNbt } = await import('@shared/minecraft/nbt')
    // Root compound with a byte array claiming 2^31-1 bytes.
    const bytes = new Uint8Array([10, 0, 0, 7, 0, 1, 97, 0x7f, 0xff, 0xff, 0xff, 0])
    expect(() => parseNbt(bytes)).toThrow(/Truncated or corrupt NBT/)
    expect(() => parseNbt(new Uint8Array([10, 0]))).toThrow(/Truncated or corrupt NBT/)
  })
})

describe('gunzipCapped', () => {
  it('round-trips normal data', () => {
    const data = new Uint8Array(100_000).map((_, i) => i % 251)
    expect(gunzipCapped(gzipSync(data))).toEqual(data)
  })

  it('stops a gzip bomb before it fills memory', () => {
    // 64 MB of zeros packs into well under 100 KB.
    const bomb = gzipSync(new Uint8Array(64 * 2 ** 20))
    expect(bomb.length).toBeLessThan(200_000)
    expect(() => gunzipCapped(bomb, 8 * 2 ** 20)).toThrow(/too large or corrupt/)
  })

  it('caps zlib streams (region-file chunks) the same way', () => {
    const data = new Uint8Array(50_000).map((_, i) => i % 7)
    expect(unzlibCapped(zlibSync(data))).toEqual(data)
    expect(() => unzlibCapped(zlibSync(new Uint8Array(32 * 2 ** 20)), 2 ** 20)).toThrow(/too large or corrupt/)
  })
})

describe('palette entries', async () => {
  const { blockStateFromNbt } = await import('../src/shared/minecraft/anvil')
  it('reads compounds, strings and lowercase keys alike', () => {
    const want = { name: 'minecraft:oak_stairs', properties: { facing: 'north' } }
    expect(blockStateFromNbt({ Name: 'minecraft:oak_stairs', Properties: { facing: 'north' } })).toEqual(want)
    expect(blockStateFromNbt('minecraft:oak_stairs[facing=north]')).toEqual(want)
    expect(blockStateFromNbt({ name: 'oak_stairs', properties: { facing: 'north' } })).toEqual(want)
    expect(blockStateFromNbt({ Name: 'minecraft:oak_stairs[facing=north]' })).toEqual(want)
    expect(blockStateFromNbt({ id: 'minecraft:oak_stairs', properties: { facing: 'north' } })).toEqual(want)
  })
  it('names an unknown layout instead of crashing on it', () => {
    expect(() => blockStateFromNbt({ block: 5 })).toThrow(/keys block/)
  })
})

describe('mixed-type NBT lists (1.21.5+)', async () => {
  const { parseNbt } = await import('../src/shared/minecraft/nbt')
  const { blockStateFromNbt } = await import('../src/shared/minecraft/anvil')
  it('unwraps items stored as {"": value} so palettes can mix names and compounds', () => {
    // root compound "" { palette: list<compound> [ {"": "minecraft:stone"}, {Name: "minecraft:oak_log", Properties: {axis: "y"}} ] }
    const bytes: number[] = []
    const str = (s: string): void => {
      const b = new TextEncoder().encode(s)
      bytes.push(b.length >> 8, b.length & 0xff, ...b)
    }
    bytes.push(10)
    str('')
    bytes.push(9)
    str('palette')
    bytes.push(10, 0, 0, 0, 2)
    bytes.push(8)
    str('')
    str('minecraft:stone')
    bytes.push(0)
    bytes.push(8)
    str('Name')
    str('minecraft:oak_log')
    bytes.push(10)
    str('Properties')
    bytes.push(8)
    str('axis')
    str('y')
    bytes.push(0, 0)
    bytes.push(0)
    const palette = (parseNbt(new Uint8Array(bytes)).palette as unknown[]).map((v) => blockStateFromNbt(v as never))
    expect(palette).toEqual([
      { name: 'minecraft:stone', properties: {} },
      { name: 'minecraft:oak_log', properties: { axis: 'y' } }
    ])
  })
})

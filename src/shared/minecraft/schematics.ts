// Turns vanilla structure files and community schematic formats into TerrainData.
//   - Vanilla structure .nbt (also what the game's own village houses, igloos, ships… are stored as)
//   - Sponge .schem v1/v2/v3 (WorldEdit, FAWE, most schematic sites)
//   - Litematica .litematic
import { gunzipCapped } from './inflate'
import { parseNbt, type NbtCompound, type NbtValue } from './nbt'
import type { BlockState, TerrainData } from '../types'
import { blockStateFromNbt, parseBlockString, stateKey } from './anvil'

export { parseBlockString }

const AIR: BlockState = { name: 'minecraft:air', properties: {} }
const INVISIBLE = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:structure_void'])

const compound = (v: NbtValue | undefined): NbtCompound | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) ? (v as NbtCompound) : undefined
const num = (v: NbtValue | undefined): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0))

/** Accumulates blocks into a TerrainData box with a deduplicated palette. */
class BoxBuilder {
  palette: BlockState[] = [AIR]
  private index = new Map<string, number>([['minecraft:air', 0]])
  blocks: Uint16Array
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number
  ) {
    if (![sx, sy, sz].every((n) => Number.isInteger(n) && n >= 0)) throw new Error('Schematic has an invalid size')
    if (sx * sy * sz > 64_000_000) throw new Error(`Schematic is too large (${sx}×${sy}×${sz})`)
    this.blocks = new Uint16Array(sx * sy * sz)
  }
  id(b: BlockState): number {
    if (INVISIBLE.has(b.name)) return 0
    const key = stateKey(b)
    let i = this.index.get(key)
    if (i === undefined) {
      if (this.palette.length >= 0xffff) throw new Error('Schematic has too many different block states')
      i = this.palette.length
      this.palette.push(b)
      this.index.set(key, i)
    }
    return i
  }
  set(x: number, y: number, z: number, paletteId: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return
    this.blocks[x + z * this.sx + y * this.sx * this.sz] = paletteId
  }
  finish(): TerrainData {
    return {
      sizeX: this.sx,
      sizeY: this.sy,
      sizeZ: this.sz,
      originX: 0,
      originY: 0,
      originZ: 0,
      palette: this.palette,
      blocks: this.blocks,
      biomePalette: ['minecraft:plains'],
      biomes: new Uint16Array(this.sx * this.sz),
      dimension: 'overworld'
    }
  }
}

/** Vanilla structure template (data/minecraft/structure/*.nbt, or saved with a structure block). */
export function structureToTerrain(root: NbtCompound): TerrainData {
  const size = (root.size as NbtValue[]).map(num)
  const palettes = root.palettes as NbtValue[][] | undefined
  const rawPalette = (root.palette as NbtValue[] | undefined) ?? palettes?.[0] ?? []
  const box = new BoxBuilder(size[0], size[1], size[2])
  const ids = rawPalette.map((p) => blockStateFromNbt(p))
  const mapped = ids.map((b) => box.id(b))
  for (const raw of (root.blocks as NbtValue[]) ?? []) {
    const b = compound(raw)!
    const [x, y, z] = (b.pos as NbtValue[]).map(num)
    let id = mapped[num(b.state)]
    const state = ids[num(b.state)]
    if (state?.name === 'minecraft:jigsaw') {
      // Jigsaw connectors turn into their "final_state" (usually air) when the game places the piece.
      const finalState = compound(b.nbt)?.final_state
      id = box.id(parseBlockString(typeof finalState === 'string' ? finalState : 'minecraft:air'))
    }
    box.set(x, y, z, id)
  }
  return box.finish()
}

function readVarints(bytes: Int8Array, count: number): Int32Array {
  const out = new Int32Array(count)
  let pos = 0
  for (let i = 0; i < count && pos < bytes.length; i++) {
    let value = 0
    let shift = 0
    for (;;) {
      const b = bytes[pos++] & 0xff
      value |= (b & 0x7f) << shift
      if (!(b & 0x80)) break
      shift += 7
    }
    out[i] = value
  }
  return out
}

/** Sponge schematic v1/v2 (root) or v3 (root.Schematic). */
export function spongeToTerrain(root: NbtCompound): TerrainData {
  const s = compound(root.Schematic) ?? root
  // Sponge sizes are unsigned shorts; NBT reads them signed.
  const w = num(s.Width) & 0xffff
  const h = num(s.Height) & 0xffff
  const l = num(s.Length) & 0xffff
  const blocksTag = compound(s.Blocks)
  const paletteTag = compound(blocksTag?.Palette ?? s.Palette)
  const data = (blocksTag?.Data ?? s.BlockData) as Int8Array | undefined
  if (!paletteTag || !data) throw new Error('Unsupported .schem file (no block palette)')
  const box = new BoxBuilder(w, h, l)
  const byIndex: number[] = []
  for (const [str, idx] of Object.entries(paletteTag)) byIndex[num(idx)] = box.id(parseBlockString(str))
  const values = readVarints(data, w * h * l)
  for (let y = 0; y < h; y++)
    for (let z = 0; z < l; z++)
      for (let x = 0; x < w; x++) box.set(x, y, z, byIndex[values[x + z * w + y * w * l]] ?? 0)
  return box.finish()
}

/** Litematica packs entries tightly, so values can span two longs. */
export function unpackSpanning(data: BigInt64Array, bits: number, count: number): Uint32Array {
  const out = new Uint32Array(count)
  const mask = (1n << BigInt(bits)) - 1n
  for (let i = 0; i < count; i++) {
    const bit = i * bits
    const li = Math.floor(bit / 64)
    const off = bit % 64
    let v = BigInt.asUintN(64, data[li] ?? 0n) >> BigInt(off)
    if (off + bits > 64) v |= BigInt.asUintN(64, data[li + 1] ?? 0n) << BigInt(64 - off)
    out[i] = Number(v & mask)
  }
  return out
}

export function litematicToTerrain(root: NbtCompound): TerrainData {
  const regions = Object.values(compound(root.Regions) ?? {}).map((r) => compound(r)!)
  if (!regions.length) throw new Error('Litematic has no regions')
  if (regions.length > 64) throw new Error('Litematic has too many regions (more than 64)')
  const vec = (c: NbtValue | undefined): number[] => {
    const v = compound(c)!
    return [num(v.x), num(v.y), num(v.z)]
  }
  const boxes = regions.map((r) => {
    const pos = vec(r.Position)
    const size = vec(r.Size)
    const min = pos.map((p, i) => (size[i] < 0 ? p + size[i] + 1 : p))
    return { r, min, size: size.map(Math.abs) }
  })
  if (boxes.reduce((n, b) => n + b.size[0] * b.size[1] * b.size[2], 0) > 128_000_000)
    throw new Error('Litematic regions are too large in total')
  const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])))
  const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.min[i] + b.size[i])))
  const box = new BoxBuilder(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  for (const { r, min, size } of boxes) {
    const palette = ((r.BlockStatePalette as NbtValue[]) ?? []).map((p) => box.id(blockStateFromNbt(p)))
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(palette.length, 1))))
    const [sx, sy, sz] = size
    if (sx * sy * sz === 0) continue
    const states = r.BlockStates instanceof BigInt64Array ? r.BlockStates : new BigInt64Array(0)
    const values = unpackSpanning(states, bits, sx * sy * sz)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++)
          box.set(
            min[0] - lo[0] + x,
            min[1] - lo[1] + y,
            min[2] - lo[2] + z,
            palette[values[(y * sz + z) * sx + x]] ?? 0
          )
  }
  return box.finish()
}

export { gunzipCapped, MAX_INFLATED } from './inflate'

const maybeGunzip = (bytes: Uint8Array): Uint8Array =>
  bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipCapped(bytes) : bytes

/** Detects the format from contents (falling back to the file extension) and converts it. */
export function readSchematic(bytes: Uint8Array, fileName = ''): TerrainData {
  const root = parseNbt(maybeGunzip(bytes))
  if (compound(root.Regions)) return litematicToTerrain(root)
  if (compound(root.Schematic) || root.BlockData || root.Palette) return spongeToTerrain(root)
  if (Array.isArray(root.size) && Array.isArray(root.blocks)) return structureToTerrain(root)
  if (root.Blocks && root.Materials)
    throw new Error(
      'This is a legacy MCEdit .schematic (pre-1.13 numeric block ids). Open it in WorldEdit/Amulet and save as .schem first.'
    )
  throw new Error(`Unrecognised schematic format${fileName ? `: ${fileName}` : ''}`)
}

/** Search tokens for a structure id like "village/plains/houses/plains_small_house_1". */
export function structureTokens(id: string): string[] {
  return id
    .toLowerCase()
    .split(/[/_\-.]+/)
    .filter((t) => t && !/^\d+$/.test(t))
}

/** Every query word must prefix-match one of the structure's tokens. */
export function searchStructures(ids: string[], query: string, limit = 200): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const scored: { id: string; score: number }[] = []
  for (const id of ids) {
    const tokens = structureTokens(id)
    let score = 0
    let ok = true
    for (const w of words) {
      const exact = tokens.includes(w) || tokens.includes(w.replace(/s$/, ''))
      if (exact) score += 2
      else if (tokens.some((t) => t.startsWith(w))) score += 1
      else {
        ok = false
        break
      }
    }
    if (ok) scored.push({ id, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((s) => s.id)
}

// Reads blocks and biomes out of Anvil region files (.mca), Java Edition 1.18+ chunk format.
import { gunzipCapped, unzlibCapped } from './inflate'
import { parseNbt, type NbtCompound, type NbtValue } from './nbt'
import type { BlockState, Dimension, TerrainData } from '../types'

const SECTOR = 4096
/** A real chunk is well under a megabyte unpacked; anything far larger is corrupt or hostile. */
const MAX_CHUNK = 16 * 2 ** 20

/** Returns the raw (decompressed) NBT root of a chunk, or null if the chunk isn't in the file. */
export function readChunkFromRegion(region: Uint8Array, localX: number, localZ: number): NbtCompound | null {
  const idx = 4 * ((localX & 31) + (localZ & 31) * 32)
  const offset = (region[idx] << 16) | (region[idx + 1] << 8) | region[idx + 2]
  const sectors = region[idx + 3]
  if (offset === 0 || sectors === 0) return null
  const start = offset * SECTOR
  if (start + 5 > region.length) return null
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength)
  const length = view.getUint32(start)
  const compression = region[start + 4]
  if (compression & 0x80) throw new Error('Chunk stored in external .mcc file is not supported yet')
  const data = region.subarray(start + 5, start + 4 + length)
  switch (compression) {
    case 1:
      return parseNbt(gunzipCapped(data, MAX_CHUNK))
    case 2:
      return parseNbt(unzlibCapped(data, MAX_CHUNK))
    case 3:
      return parseNbt(data)
    default:
      throw new Error(`Chunk compression type ${compression} is not supported (set region-file-compression=deflate)`)
  }
}

/** Unpacks a 1.16+ paletted container (entries never span two longs). */
export function unpackPalettedIndices(data: BigInt64Array | undefined, bits: number, count: number): Uint16Array {
  const out = new Uint16Array(count)
  if (!data || bits === 0) return out
  const perLong = Math.floor(64 / bits)
  const mask = (1 << bits) - 1
  // Read each long as two 32-bit halves (little-endian host): ~18x faster than BigInt shifts.
  const u = new Uint32Array(data.buffer, data.byteOffset, data.length * 2)
  for (let l = 0, i = 0; l < data.length && i < count; l++) {
    const lo = u[2 * l]
    const hi = u[2 * l + 1]
    for (let k = 0; k < perLong && i < count; k++, i++) {
      const shift = k * bits
      const v =
        shift + bits <= 32 ? lo >>> shift : shift >= 32 ? hi >>> (shift - 32) : (lo >>> shift) | (hi << (32 - shift))
      out[i] = v & mask
    }
  }
  return out
}

const bitsFor = (n: number): number => (n <= 1 ? 0 : Math.ceil(Math.log2(n)))

export interface DecodedSection {
  y: number
  palette: BlockState[]
  /** 4096 palette indices, index = (y*16 + z)*16 + x */
  blocks: Uint16Array
  biomePalette: string[]
  /** 64 biome palette indices, index = (y*4 + z)*4 + x (4x4x4 cells) */
  biomes: Uint16Array
}

export interface DecodedChunk {
  x: number
  z: number
  status: string
  sections: Map<number, DecodedSection>
}

function asCompound(v: NbtValue | undefined): NbtCompound | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) ? (v as NbtCompound) : undefined
}

/** Parses "minecraft:oak_stairs[facing=east,half=bottom]". */
export function parseBlockString(s: string): BlockState {
  const m = /^([^[]+)(?:\[(.*)\])?$/.exec(s.trim())
  if (!m) return { name: 'minecraft:air', properties: {} }
  const name = m[1].includes(':') ? m[1] : `minecraft:${m[1]}`
  const properties: Record<string, string> = {}
  if (m[2])
    for (const pair of m[2].split(',')) {
      const [k, v] = pair.split('=')
      if (k && v !== undefined) properties[k.trim()] = v.trim()
    }
  return { name, properties }
}

/**
 * A block state as saved in NBT palettes: a {Name, Properties} compound (how 1.18–1.21 save it), or the
 * "minecraft:oak_stairs[facing=north]" string form.
 */
export function blockStateFromNbt(v: NbtValue | undefined): BlockState {
  if (typeof v === 'string') return parseBlockString(v)
  const c = asCompound(v)
  // 1.18–1.21 save {Name, Properties}; 26.x saves {id, properties}.
  const name = c?.Name ?? c?.name ?? c?.id
  if (!c || typeof name !== 'string') {
    // Unknown layout (a newer save format): say what it looks like, so it can be supported.
    const shape = c
      ? `an entry with keys ${
          Object.keys(c)
            .map((k) => k || '""')
            .join(', ') || 'none'
        }`
      : `a ${typeof v} value`
    throw new Error(`This Minecraft version saves blocks in a format ThumbCraft can't read yet (${shape})`)
  }
  if (name.includes('[')) return parseBlockString(name)
  const props: Record<string, string> = {}
  const raw = asCompound(c.Properties ?? c.properties)
  if (raw) for (const [k, val] of Object.entries(raw)) props[k] = String(val)
  return { name: name.includes(':') ? name : `minecraft:${name}`, properties: props }
}

export function decodeChunk(root: NbtCompound): DecodedChunk {
  if (asCompound(root.Level)) {
    throw new Error('This world was saved by Minecraft 1.17 or older. Open it once in 1.18+ to upgrade it.')
  }
  const sections = new Map<number, DecodedSection>()
  for (const raw of (root.sections as NbtValue[] | undefined) ?? []) {
    const s = asCompound(raw)
    if (!s) continue
    const bs = asCompound(s.block_states)
    const bi = asCompound(s.biomes)
    if (!bs) continue
    const palette: BlockState[] = ((bs.palette as NbtValue[]) ?? []).map(blockStateFromNbt)
    const blockBits = palette.length <= 1 ? 0 : Math.max(4, bitsFor(palette.length))
    const biomePalette = ((bi?.palette as NbtValue[]) ?? []).map(String)
    sections.set(Number(s.Y), {
      y: Number(s.Y),
      palette,
      blocks: unpackPalettedIndices(bs.data as BigInt64Array | undefined, blockBits, 4096),
      biomePalette,
      biomes: unpackPalettedIndices(bi?.data as BigInt64Array | undefined, bitsFor(biomePalette.length), 64)
    })
  }
  return {
    x: Number(root.xPos),
    z: Number(root.zPos),
    status: String(root.Status ?? ''),
    sections
  }
}

/** Reads region bytes for region (rx, rz), or null if that region file doesn't exist. */
export type RegionSource = (rx: number, rz: number) => Uint8Array | null

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

export class ChunkCache {
  private regions = new Map<string, Uint8Array | null>()
  private chunks = new Map<string, DecodedChunk | null>()
  constructor(private source: RegionSource) {}

  chunk(cx: number, cz: number): DecodedChunk | null {
    const key = `${cx},${cz}`
    if (this.chunks.has(key)) return this.chunks.get(key)!
    const rx = cx >> 5
    const rz = cz >> 5
    const rkey = `${rx},${rz}`
    if (!this.regions.has(rkey)) this.regions.set(rkey, this.source(rx, rz))
    const region = this.regions.get(rkey)!
    const root = region ? readChunkFromRegion(region, cx & 31, cz & 31) : null
    const chunk = root ? decodeChunk(root) : null
    this.chunks.set(key, chunk)
    return chunk
  }

  block(x: number, y: number, z: number): BlockState | null {
    const c = this.chunk(x >> 4, z >> 4)
    const s = c?.sections.get(y >> 4)
    if (!s) return null
    return s.palette[s.blocks[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)]] ?? null
  }

  biome(x: number, y: number, z: number): string | null {
    const c = this.chunk(x >> 4, z >> 4)
    const s = c?.sections.get(y >> 4)
    if (!s || s.biomePalette.length === 0) return null
    const i = (((y & 15) >> 2) * 4 + ((z & 15) >> 2)) * 4 + ((x & 15) >> 2)
    return s.biomePalette[s.biomes[i]] ?? null
  }

  /** Every chunk overlapping the box exists and has finished generating. */
  allGenerated(minCX: number, minCZ: number, maxCX: number, maxCZ: number): boolean {
    for (let cx = minCX; cx <= maxCX; cx++)
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const c = this.chunk(cx, cz)
        if (!c || !/(^|:)full$/.test(c.status)) return false
      }
    return true
  }
}

export interface ExtractOptions {
  centerX: number
  centerZ: number
  size: number
  dimension: Dimension
  /** If set, take a vertical window around this Y (caves, the Nether). Otherwise follow the surface. */
  focusY?: number
  /** Blocks of ground kept below the lowest surface column. */
  depthBelowSurface?: number
  minWorldY?: number
  maxWorldY?: number
}

const isAir = (b: BlockState | null): boolean => !b || AIR.has(b.name)

/** Cuts a box of real blocks out of the world. */
export function extractTerrain(cache: ChunkCache, opts: ExtractOptions): TerrainData {
  const size = opts.size
  const x0 = Math.floor(opts.centerX - size / 2)
  const z0 = Math.floor(opts.centerZ - size / 2)
  const minWorldY = opts.minWorldY ?? (opts.dimension === 'overworld' ? -64 : 0)
  const maxWorldY = opts.maxWorldY ?? (opts.dimension === 'the_nether' ? 255 : opts.dimension === 'the_end' ? 255 : 319)

  let yMin: number
  let yMax: number
  const surface = new Int32Array(size * size).fill(minWorldY)
  if (opts.focusY !== undefined) {
    yMin = Math.max(minWorldY, opts.focusY - 16)
    yMax = Math.min(maxWorldY, opts.focusY + 24)
    for (let i = 0; i < surface.length; i++) surface[i] = opts.focusY
  } else {
    let lowest = Infinity
    let highest = -Infinity
    for (let dz = 0; dz < size; dz++)
      for (let dx = 0; dx < size; dx++) {
        let y = maxWorldY
        while (y > minWorldY && isAir(cache.block(x0 + dx, y, z0 + dz))) y--
        surface[dx + dz * size] = y
        lowest = Math.min(lowest, y)
        highest = Math.max(highest, y)
      }
    if (!Number.isFinite(lowest)) throw new Error('Area contains no blocks')
    yMin = Math.max(minWorldY, lowest - (opts.depthBelowSurface ?? 8))
    yMax = highest
  }

  const sizeY = yMax - yMin + 1
  const palette: BlockState[] = [{ name: 'minecraft:air', properties: {} }]
  const paletteIndex = new Map<string, number>([['minecraft:air', 0]])
  const blocks = new Uint16Array(size * size * sizeY)
  for (let dy = 0; dy < sizeY; dy++)
    for (let dz = 0; dz < size; dz++)
      for (let dx = 0; dx < size; dx++) {
        const b = cache.block(x0 + dx, yMin + dy, z0 + dz)
        if (isAir(b)) continue
        const key = stateKey(b!)
        let idx = paletteIndex.get(key)
        if (idx === undefined) {
          idx = palette.length
          palette.push(b!)
          paletteIndex.set(key, idx)
        }
        blocks[dx + dz * size + dy * size * size] = idx
      }

  const biomePalette: string[] = []
  const biomeIndex = new Map<string, number>()
  const biomes = new Uint16Array(size * size)
  for (let dz = 0; dz < size; dz++)
    for (let dx = 0; dx < size; dx++) {
      const y = Math.min(Math.max(surface[dx + dz * size], yMin), yMax)
      const id = cache.biome(x0 + dx, y, z0 + dz) ?? 'minecraft:plains'
      let idx = biomeIndex.get(id)
      if (idx === undefined) {
        idx = biomePalette.length
        biomePalette.push(id)
        biomeIndex.set(id, idx)
      }
      biomes[dx + dz * size] = idx
    }

  return {
    sizeX: size,
    sizeY,
    sizeZ: size,
    originX: x0,
    originY: yMin,
    originZ: z0,
    palette,
    blocks,
    biomePalette,
    biomes,
    dimension: opts.dimension
  }
}

export function stateKey(b: BlockState): string {
  const props = Object.keys(b.properties)
    .sort()
    .map((k) => `${k}=${b.properties[k]}`)
    .join(',')
  return props ? `${b.name}[${props}]` : b.name
}

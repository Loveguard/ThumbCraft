// Small hand-built block props for scenes (a table, a glass pane, a white room, distant towers) and two
// remixes of a structure (scrambled into rainbow blocks, or ruined). All plain TerrainData.
import type { BlockState, Dimension, TerrainData } from '../types'

/** Deterministic noise in 0…1 for a block position. */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2246822519) ^ Math.imul(seed, 3266489917)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A sizeX×sizeY×sizeZ box filled by `block(x, y, z)` (a block id like "oak_planks", or null for air). */
export function blockBox(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  block: (x: number, y: number, z: number) => string | [string, Record<string, string>] | null,
  dimension: Dimension = 'overworld'
): TerrainData {
  const palette: BlockState[] = [{ name: 'minecraft:air', properties: {} }]
  const index = new Map<string, number>([['minecraft:air{}', 0]])
  const blocks = new Uint16Array(sizeX * sizeY * sizeZ)
  for (let y = 0; y < sizeY; y++)
    for (let z = 0; z < sizeZ; z++)
      for (let x = 0; x < sizeX; x++) {
        const b = block(x, y, z)
        if (!b) continue
        const [id, properties] = typeof b === 'string' ? [b, {}] : b
        const name = `minecraft:${id}`
        const key = `${name}${JSON.stringify(properties)}`
        let i = index.get(key)
        if (i === undefined) {
          i = palette.length
          palette.push({ name, properties })
          index.set(key, i)
        }
        blocks[x + z * sizeX + y * sizeX * sizeZ] = i
      }
  return {
    sizeX,
    sizeY,
    sizeZ,
    originX: 0,
    originY: 0,
    originZ: 0,
    palette,
    blocks,
    biomePalette: ['minecraft:plains'],
    biomes: new Uint16Array(sizeX * sizeZ),
    dimension
  }
}

/** A long wooden table: a plank top on four log legs. Its top surface is TABLE_HEIGHT blocks up. */
export const TABLE_HEIGHT = 3
export function buildTable(length = 16, depth = 4): TerrainData {
  return blockBox(length, TABLE_HEIGHT, depth, (x, y, z) => {
    if (y === TABLE_HEIGHT - 1) return 'spruce_planks'
    const leg = (x === 1 || x === length - 2) && (z === 0 || z === depth - 1)
    return leg ? ['stripped_spruce_log', { axis: 'y' }] : null
  })
}

/** A big flat sheet of hazy white glass, one block thick, for "looking through a pane" shots. */
export function buildGlassPane(width = 18, height = 14): TerrainData {
  return blockBox(width, height, 1, () => 'white_stained_glass')
}

/** A bright, empty room: white floor and two tall white walls, open towards the camera and the back. */
export function buildWhiteRoom(width = 18, length = 26, height = 18): TerrainData {
  return blockBox(width, height, length, (x, y) => {
    if (y === 0) return 'white_concrete'
    if (x === 0 || x === width - 1) return 'white_concrete'
    return null
  })
}

/** A scatter of tall dark towers, for a blurred city skyline far behind the subject. */
export function buildDarkTowers(width = 60, depth = 10): TerrainData {
  const towers: [number, number, number][] = []
  for (let i = 0; i < 9; i++)
    towers.push([
      Math.floor(hash(i, 1, 2, 7) * (width - 4)),
      10 + Math.floor(hash(i, 3, 4, 7) * 18),
      3 + Math.floor(hash(i, 5, 6, 7) * 3)
    ])
  return blockBox(width, 30, depth, (x, y, z) => {
    for (const [tx, h, w] of towers)
      if (x >= tx && x < tx + w && z >= 2 && z < 2 + w && y < h)
        return hash(x, y, z, 9) < 0.06 ? 'purple_stained_glass' : 'blackstone'
    return null
  })
}

const RAINBOW = [
  'red_wool',
  'orange_wool',
  'yellow_wool',
  'lime_wool',
  'light_blue_wool',
  'blue_wool',
  'purple_wool',
  'magenta_wool',
  'white_concrete',
  'cyan_terracotta',
  'brown_terracotta'
]

/** The same shape rebuilt from mismatched coloured blocks (a "the AI didn't get it" build). */
export function scrambleBlocks(t: TerrainData, seed = 1): TerrainData {
  return blockBox(t.sizeX, t.sizeY, t.sizeZ, (x, y, z) => {
    const state = t.palette[t.blocks[x + z * t.sizeX + y * t.sizeX * t.sizeZ]]
    if (!state || /(^|:)(air|cave_air|void_air|structure_void|jigsaw)$/.test(state.name)) return null
    return RAINBOW[Math.floor(hash(x, y, z, seed) * RAINBOW.length)]
  })
}

/** The same build half-collapsed: the upper part mostly gone, some of it fallen as rubble around the base. */
export function ruinBlocks(t: TerrainData, seed = 1): TerrainData {
  const at = (x: number, y: number, z: number): BlockState | undefined =>
    t.palette[t.blocks[x + z * t.sizeX + y * t.sizeX * t.sizeZ]]
  const solid = (s: BlockState | undefined): s is BlockState =>
    !!s && !/(^|:)(air|cave_air|void_air|structure_void|jigsaw)$/.test(s.name)
  const pad = 2
  return blockBox(t.sizeX + pad * 2, t.sizeY, t.sizeZ + pad * 2, (x, y, z) => {
    const sx = x - pad
    const sz = z - pad
    const inside = sx >= 0 && sz >= 0 && sx < t.sizeX && sz < t.sizeZ
    const s = inside ? at(sx, y, sz) : undefined
    // Keep the base; lose more the higher up, with a big hole on one side.
    const keep = 1 - (y / t.sizeY) * 1.1 - (sx > t.sizeX / 2 ? 0.25 : 0)
    if (solid(s) && hash(x, y, z, seed) < keep) return [s.name.replace(/^minecraft:/, ''), s.properties]
    // Rubble on the ground around it.
    if (y === 1 && !solid(s) && hash(x, 0, z, seed + 1) < 0.18)
      return hash(x, 1, z, seed) < 0.5 ? 'cobblestone' : 'oak_planks'
    return null
  })
}

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

// ---- Quick props for the Builds tab: small, recognisable builds that thumbnails use a lot.

/** A lit nether portal: an obsidian frame (4×5 outside) filled with portal blocks, facing +z. */
export function buildNetherPortal(): TerrainData {
  return blockBox(4, 5, 1, (x, y) => {
    if (x === 0 || x === 3 || y === 0 || y === 4) return 'obsidian'
    return ['nether_portal', { axis: 'x' }]
  })
}

/** The classic first-night dirt hut: dirt walls, a door gap, a torch and a flat oak roof. */
export function buildStarterHouse(): TerrainData {
  const n = 5
  return blockBox(n, 5, n, (x, y, z) => {
    const wall = x === 0 || z === 0 || x === n - 1 || z === n - 1
    if (y === 4) return 'oak_planks'
    if (!wall) {
      if (y === 0) return 'dirt'
      // A torch on the back wall, lighting the inside.
      return x === 2 && z === 1 && y === 2 ? ['wall_torch', { facing: 'south' }] : null
    }
    if (z === n - 1 && x === 2 && (y === 1 || y === 2)) return null // doorway at the front
    if (x === 0 && z === 2 && y === 2) return 'glass'
    return y === 0 ? 'cobblestone' : 'dirt'
  })
}

/** A treasure hoard: chests behind a heap of gold, diamond and emerald blocks. */
export function buildTreasurePile(): TerrainData {
  const heap = ['gold_block', 'gold_block', 'diamond_block', 'gold_block', 'emerald_block', 'gold_block']
  return blockBox(5, 3, 4, (x, y, z) => {
    if (z === 0 && y === 0 && x >= 1 && x <= 3) return ['chest', { facing: 'south' }]
    const h = (x === 2 ? 2 : x === 1 || x === 3 ? 1 : 0) - (z === 3 ? 1 : 0)
    if (z >= 1 && y <= h) return heap[(x * 7 + y * 3 + z * 5) % heap.length]
    return null
  })
}

/** A stack of TNT stepped like a pyramid (5×5 base), for "blowing it all up" shots. */
export function buildTntStack(): TerrainData {
  return blockBox(5, 3, 5, (x, y, z) => {
    const ring = Math.max(Math.abs(x - 2), Math.abs(z - 2))
    return ring <= 2 - y ? 'tnt' : null
  })
}

/** A display pedestal: stepped quartz with a gold trim and a diamond block on top. */
export function buildPodium(): TerrainData {
  return blockBox(5, 4, 5, (x, y, z) => {
    const ring = Math.max(Math.abs(x - 2), Math.abs(z - 2))
    if (y === 0) return ring === 2 ? 'smooth_quartz' : 'quartz_block'
    if (y === 1) return ring <= 1 ? (ring === 1 ? 'gold_block' : 'quartz_pillar') : null
    if (y === 2) return ring === 0 ? 'quartz_pillar' : null
    return ring === 0 ? 'diamond_block' : null
  })
}

/** A beacon on a full iron pyramid (one tier, 3×3), its beam lighting the sky. */
export function buildBeacon(): TerrainData {
  return blockBox(3, 2, 3, (x, y, z) => (y === 0 ? 'iron_block' : x === 1 && z === 1 ? 'beacon' : null))
}

/** A campfire with log seats around it, for night-time survival scenes. */
export function buildCampfire(): TerrainData {
  return blockBox(5, 1, 5, (x, _y, z) => {
    if (x === 2 && z === 2) return ['campfire', { lit: 'true' }]
    if ((x === 0 || x === 4) && z >= 1 && z <= 3) return ['oak_log', { axis: 'z' }]
    if ((z === 0 || z === 4) && x >= 1 && x <= 3) return ['oak_log', { axis: 'x' }]
    return null
  })
}

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

/** A beacon on a full iron pyramid (one tier, 3×3), its beam lighting the sky. */
export function buildBeacon(): TerrainData {
  return blockBox(3, 2, 3, (x, y, z) => (y === 0 ? 'iron_block' : x === 1 && z === 1 ? 'beacon' : null))
}

/** A floating sky island: grass on top, dirt and stone tapering to a point underneath, an oak tree on top. */
export function buildSkyIsland(): TerrainData {
  const n = 11
  const c = 5
  const top = 7 // grass layer
  return blockBox(n, top + 7, n, (x, y, z) => {
    const d = Math.hypot(x - c, z - c)
    // The tree, a little off centre.
    const tx = c + 1
    const tz = c - 1
    if (x === tx && z === tz && y > top && y <= top + 4) return ['oak_log', { axis: 'y' }]
    const ly = y - (top + 3)
    if (ly >= 0 && ly <= 2) {
      const lr = Math.max(Math.abs(x - tx), Math.abs(z - tz))
      if (lr <= 2 - (ly === 2 ? 1 : 0) && !(lr === 2 && Math.abs(x - tx) === 2 && Math.abs(z - tz) === 2))
        return ['oak_leaves', { persistent: 'true', distance: '1' }]
    }
    if (y > top) return null
    // Underside: the radius shrinks towards the bottom, ragged by noise.
    const radius = 5.3 - (top - y) * 0.72 + hash(x, y, z, 5) * 0.8
    if (d > radius) return null
    if (y === top) return 'grass_block'
    if (y >= top - 2) return 'dirt'
    return hash(x, y, z, 9) < 0.12 ? 'coal_ore' : 'stone'
  })
}

/**
 * A monster-spawner dungeon: a mossy cobblestone room (7×7) with the spawner in the middle and a chest in two
 * corners, open at the front and the top so the camera sees in.
 */
export function buildSpawnerDungeon(): TerrainData {
  return blockBox(7, 4, 7, (x, y, z) => {
    const r = hash(x, y, z, 53)
    const stone = r < 0.45 ? 'mossy_cobblestone' : 'cobblestone'
    if (y === 0) return stone
    if (x === 3 && z === 3) return y === 1 ? 'spawner' : null
    if (y === 1 && z === 1 && (x === 1 || x === 5)) return ['chest', { facing: 'south', type: 'single' }]
    // Back and side walls, crumbling towards the front and the top.
    const wall = z === 0 || x === 0 || x === 6
    if (!wall) return null
    return hash(x, y, z, 54) < 0.25 + (y / 4) * 0.2 + (z / 6) * 0.35 ? null : stone
  })
}

/** An enchanting setup: the table in the middle, two-high bookshelf walls round three sides, lanterns on top. */
export function buildEnchantingSetup(): TerrainData {
  return blockBox(5, 3, 5, (x, y, z) => {
    const ring = Math.max(Math.abs(x - 2), Math.abs(z - 2))
    if (ring === 0) return y === 0 ? 'enchanting_table' : null
    if (ring !== 2) return null
    if (z === 4 && x >= 1 && x <= 3) return null // open front
    if (y === 2) return (x === 0 || x === 4) && z === 0 ? 'lantern' : null
    return 'bookshelf'
  })
}

/**
 * The stronghold end portal: twelve frames with eyes in, round the black portal surface, on a cracked
 * stone-brick floor.
 */
export function buildEndPortal(): TerrainData {
  return blockBox(7, 2, 7, (x, y, z) => {
    const dx = x - 3
    const dz = z - 3
    const ring = Math.max(Math.abs(dx), Math.abs(dz))
    if (y === 0) {
      // The game draws the portal surface in code, so a black floor under it stands in for the void.
      if (ring <= 1) return 'black_concrete'
      const r = hash(x, 0, z, 41)
      return r < 0.2 ? 'mossy_stone_bricks' : r < 0.35 ? 'cracked_stone_bricks' : 'stone_bricks'
    }
    if (ring <= 1) return 'end_portal'
    if (ring !== 2 || Math.abs(dx) === Math.abs(dz)) return null
    // Each frame faces the middle.
    const facing = dz === -2 ? 'south' : dz === 2 ? 'north' : dx === -2 ? 'east' : 'west'
    return ['end_portal_frame', { facing, eye: 'true' }]
  })
}

// Instant backdrops: small hand-built sets (rolling meadow, snowy taiga, desert, nether) made of real block
// types and drawn with the game's own textures. They need no Java or world generation, so a new user gets a
// Minecraft-looking scene in a second; generated biomes stay the accurate option. Only blocks that exist in
// every supported version (1.18+) are used.
import type { BlockState, Dimension, TerrainData } from '../types'

export type BackdropId = 'meadow' | 'forest' | 'taiga' | 'desert' | 'island' | 'cave' | 'nether' | 'ravine'
type HeightmapId = 'meadow' | 'forest' | 'taiga' | 'desert' | 'nether'

export const BACKDROPS: { id: BackdropId; name: string; biome: string }[] = [
  { id: 'meadow', name: 'Meadow', biome: 'minecraft:plains' },
  { id: 'forest', name: 'Dark forest', biome: 'minecraft:dark_forest' },
  { id: 'taiga', name: 'Snowy taiga', biome: 'minecraft:snowy_taiga' },
  { id: 'desert', name: 'Desert', biome: 'minecraft:desert' },
  { id: 'island', name: 'Desert island', biome: 'minecraft:beach' },
  { id: 'cave', name: 'Deep cave', biome: 'minecraft:dripstone_caves' },
  { id: 'nether', name: 'Nether', biome: 'minecraft:crimson_forest' },
  { id: 'ravine', name: 'Lava ravine', biome: 'minecraft:basalt_deltas' }
]

const SIZE = 64
const HEIGHT = 28
/** Ground level at the centre of every backdrop (where the camera looks and players stand). */
export const BACKDROP_GROUND = 8

/** Deterministic hash noise, so a backdrop always looks the same. */
function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smoothNoise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale
  const fz = z / scale
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const tx = fx - x0
  const tz = fz - z0
  const s = (t: number): number => t * t * (3 - 2 * t)
  const a = hash(x0, z0, seed)
  const b = hash(x0 + 1, z0, seed)
  const c = hash(x0, z0 + 1, seed)
  const d = hash(x0 + 1, z0 + 1, seed)
  return a + (b - a) * s(tx) + (c - a) * s(tz) + (a - b - c + d) * s(tx) * s(tz)
}

class Builder {
  palette: BlockState[] = [{ name: 'minecraft:air', properties: {} }]
  private index = new Map<string, number>([['minecraft:air', 0]])
  blocks = new Uint16Array(SIZE * SIZE * HEIGHT)

  id(name: string, properties: Record<string, string> = {}): number {
    const key = `${name}${JSON.stringify(properties)}`
    let i = this.index.get(key)
    if (i === undefined) {
      i = this.palette.length
      this.palette.push({ name: `minecraft:${name}`, properties })
      this.index.set(key, i)
    }
    return i
  }
  set(x: number, y: number, z: number, block: number): void {
    if (x < 0 || z < 0 || y < 0 || x >= SIZE || z >= SIZE || y >= HEIGHT) return
    this.blocks[x + z * SIZE + y * SIZE * SIZE] = block
  }
  get(x: number, y: number, z: number): number {
    if (x < 0 || z < 0 || y < 0 || x >= SIZE || z >= SIZE || y >= HEIGHT) return 0
    return this.blocks[x + z * SIZE + y * SIZE * SIZE]
  }
}

interface Tree {
  log: string
  leaves: string
  /** A tall cone (spruce) instead of a round crown. */
  cone?: boolean
}

function plantTree(b: Builder, x: number, ground: number, z: number, tree: Tree, height: number): void {
  const log = b.id(tree.log, { axis: 'y' })
  const leaves = b.id(tree.leaves, { distance: '1', persistent: 'true', waterlogged: 'false' })
  const top = ground + height
  for (let y = ground + 1; y <= top; y++) b.set(x, y, z, log)
  const leaf = (lx: number, ly: number, lz: number): void => {
    if (b.get(lx, ly, lz) === 0) b.set(lx, ly, lz, leaves)
  }
  if (tree.cone) {
    for (let layer = 0; layer < height - 1; layer++) {
      const y = top - layer
      const r = layer === 0 ? 0 : layer % 2 === 1 ? 1 : 2
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) if (Math.abs(dx) + Math.abs(dz) <= r + (r > 1 ? 1 : 0)) leaf(x + dx, y, z + dz)
    }
    leaf(x, top + 1, z)
    return
  }
  // Vanilla-style oak crown: two wide layers, two narrow ones on top.
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy <= -1 ? 2 : 1
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r
        if (corner && (dy === 1 || hash(x + dx, z + dz, dy + 9) < 0.5)) continue
        leaf(x + dx, top + dy, z + dz)
      }
  }
}

interface Look {
  dimension: Dimension
  biome: string
  seed: number
  /** Hill height in blocks. */
  hills: number
  top: (x: number, z: number) => [string, Record<string, string>?]
  under: string
  deep: string
  /** Liquid filling hollows below this height (water or lava). */
  pool?: { block: string; level: number }
  trees?: { tree: Tree; chance: number; height: [number, number] }
  /** Things standing on the surface (flowers, cacti, snow…), chosen per column. */
  decorate?: (b: Builder, x: number, y: number, z: number, r: number) => void
  /** Blocks stuck to the ceiling-less sky in the nether (glowstone clusters). */
  extra?: (b: Builder) => void
}

const LOOKS: Record<HeightmapId, Look> = {
  meadow: {
    dimension: 'overworld',
    biome: 'minecraft:plains',
    seed: 11,
    hills: 6,
    top: () => ['grass_block', { snowy: 'false' }],
    under: 'dirt',
    deep: 'stone',
    pool: { block: 'water', level: BACKDROP_GROUND - 2 },
    trees: { tree: { log: 'oak_log', leaves: 'oak_leaves' }, chance: 0.012, height: [4, 6] },
    decorate: (b, x, y, z, r) => {
      if (r < 0.05) b.set(x, y + 1, z, b.id(['poppy', 'dandelion', 'oxeye_daisy', 'azure_bluet'][Math.floor(r * 80)]))
    }
  },
  forest: {
    dimension: 'overworld',
    biome: 'minecraft:dark_forest',
    seed: 61,
    hills: 4,
    top: () => ['grass_block', { snowy: 'false' }],
    under: 'dirt',
    deep: 'stone',
    trees: { tree: { log: 'dark_oak_log', leaves: 'dark_oak_leaves' }, chance: 0.07, height: [5, 8] },
    decorate: (b, x, y, z, r) => {
      if (r < 0.08) b.set(x, y + 1, z, b.id('fern'))
      else if (r < 0.1) b.set(x, y + 1, z, b.id(r < 0.09 ? 'brown_mushroom' : 'red_mushroom'))
    }
  },
  taiga: {
    dimension: 'overworld',
    biome: 'minecraft:snowy_taiga',
    seed: 23,
    hills: 8,
    top: () => ['grass_block', { snowy: 'true' }],
    under: 'dirt',
    deep: 'stone',
    pool: { block: 'ice', level: BACKDROP_GROUND - 2 },
    trees: { tree: { log: 'spruce_log', leaves: 'spruce_leaves', cone: true }, chance: 0.02, height: [6, 9] },
    decorate: (b, x, y, z) => {
      if (b.get(x, y + 1, z) === 0) b.set(x, y + 1, z, b.id('snow', { layers: '1' }))
    }
  },
  desert: {
    dimension: 'overworld',
    biome: 'minecraft:desert',
    seed: 37,
    hills: 5,
    top: () => ['sand'],
    under: 'sand',
    deep: 'sandstone',
    decorate: (b, x, y, z, r) => {
      if (r < 0.006) for (let h = 1; h <= 2 + Math.floor(r * 300); h++) b.set(x, y + h, z, b.id('cactus', { age: '0' }))
      else if (r < 0.02) b.set(x, y + 1, z, b.id('dead_bush'))
    }
  },
  nether: {
    dimension: 'the_nether',
    biome: 'minecraft:crimson_forest',
    seed: 51,
    hills: 7,
    top: (x, z) => (hash(x, z, 5) < 0.85 ? ['crimson_nylium'] : ['netherrack']),
    under: 'netherrack',
    deep: 'netherrack',
    pool: { block: 'lava', level: BACKDROP_GROUND - 2 },
    trees: { tree: { log: 'crimson_stem', leaves: 'nether_wart_block' }, chance: 0.012, height: [5, 7] },
    decorate: (b, x, y, z, r) => {
      if (r < 0.04) b.set(x, y + 1, z, b.id('crimson_roots'))
      else if (r < 0.05) b.set(x, y + 1, z, b.id('crimson_fungus'))
    },
    extra: (b) => {
      // A few shroomlights in the crowns, as in the real crimson forest.
      for (let i = 0; i < b.blocks.length; i++)
        if (b.palette[b.blocks[i]].name === 'minecraft:nether_wart_block' && hash(i, 3, 77) < 0.06)
          b.blocks[i] = b.id('shroomlight')
    }
  }
}

/** Builds one backdrop. The centre column's surface is at BACKDROP_GROUND. */
export function buildBackdrop(id: BackdropId): TerrainData {
  if (id === 'island') return finish(buildIsland(), 'minecraft:beach', 'overworld')
  if (id === 'cave') return finish(buildCave(), 'minecraft:dripstone_caves', 'overworld')
  if (id === 'ravine') return finish(buildRavine(), 'minecraft:basalt_deltas', 'the_nether')
  const look = LOOKS[id]
  const b = new Builder()
  const c = SIZE / 2
  const heightAt = (x: number, z: number): number => {
    const d = Math.hypot(x - c, z - c)
    // Flat where the subject stands, hills rising towards the back and sides.
    const open = Math.min(1, Math.max(0, (d - 6) / 18))
    const n = smoothNoise(x, z, 14, look.seed) * 0.7 + smoothNoise(x, z, 5, look.seed + 1) * 0.3
    return Math.round(BACKDROP_GROUND + (n - 0.35) * look.hills * open)
  }
  const tops: number[] = []
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const h = heightAt(x, z)
      tops.push(h)
      const [top, props] = look.top(x, z)
      for (let y = 0; y <= h; y++)
        b.set(x, y, z, y === h ? b.id(top, props) : y >= h - 3 ? b.id(look.under) : b.id(look.deep))
      if (look.pool && h < look.pool.level)
        for (let y = h + 1; y <= look.pool.level; y++)
          b.set(x, y, z, b.id(look.pool.block, look.pool.block === 'ice' ? {} : { level: '0' }))
    }
  for (let z = 2; z < SIZE - 2; z++)
    for (let x = 2; x < SIZE - 2; x++) {
      const h = tops[x + z * SIZE]
      if (look.pool && h < look.pool.level) continue
      const near = Math.hypot(x - c, z - c) < 7 // keep the stage clear
      const r = hash(x, z, look.seed + 100)
      if (look.trees && !near && r < look.trees.chance) {
        const [lo, hi] = look.trees.height
        plantTree(b, x, h, z, look.trees.tree, lo + Math.floor(hash(x, z, 3) * (hi - lo + 1)))
      } else if (!near) look.decorate?.(b, x, h, z, hash(x, z, look.seed + 200))
      else if (id === 'taiga') look.decorate?.(b, x, h, z, 1)
    }
  look.extra?.(b)
  return finish(b, look.biome, look.dimension)
}

function finish(b: Builder, biome: string, dimension: Dimension): TerrainData {
  const c = SIZE / 2
  return {
    sizeX: SIZE,
    sizeY: HEIGHT,
    sizeZ: SIZE,
    originX: -c,
    originY: 0,
    originZ: -c,
    palette: b.palette,
    blocks: b.blocks,
    biomePalette: [biome],
    biomes: new Uint16Array(SIZE * SIZE),
    dimension
  }
}

const G = BACKDROP_GROUND

/** A small sandy island with two palms in open sea; the sea is a block below the sand. */
function buildIsland(): Builder {
  const b = new Builder()
  const c = SIZE / 2
  const sand = b.id('sand')
  const sandstone = b.id('sandstone')
  const stone = b.id('stone')
  const gravel = b.id('gravel')
  const water = b.id('water', { level: '0' })
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, z - c)
      const r = 9 + (smoothNoise(x, z, 6, 71) - 0.5) * 5
      // Flat top, a sloping beach, then the sea floor falling away.
      const top = d < r - 3 ? G : d < r ? G - 1 : Math.max(2, Math.round(G - 2 - (d - r) * 0.35))
      for (let y = 0; y <= top; y++)
        b.set(x, y, z, y >= top - 2 ? (top < G - 2 && hash(x, z, 4) < 0.3 ? gravel : sand) : y > 2 ? sandstone : stone)
      for (let y = top + 1; y <= G - 1; y++) b.set(x, y, z, water)
      if (top < G - 3 && hash(x, z, 9) < 0.06) b.set(x, top + 1, z, b.id('seagrass'))
    }
  // Two leaning palms (jungle trunks with a flat crown) at the island's edge, clear of the stage.
  const palm = (x: number, z: number, h: number, lean: number): void => {
    const log = b.id('jungle_log', { axis: 'y' })
    const leaves = b.id('jungle_leaves', { distance: '1', persistent: 'true', waterlogged: 'false' })
    let px = x
    for (let y = 1; y <= h; y++) {
      if (y > 2 && y % 2 === 0) px += lean
      b.set(px, G + y, z, log)
    }
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [3, 1],
      [-3, -1],
      [1, 3],
      [-1, -3]
    ])
      b.set(px + dx, G + h + 1, z + dz, leaves)
    for (const [dx, dz] of [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3]
    ])
      b.set(px + dx, G + h, z + dz, leaves)
  }
  palm(c - 6, c - 3, 6, -1)
  palm(c + 5, c - 5, 7, 1)
  b.set(c + 3, G + 1, c + 2, b.id('dead_bush'))
  return b
}

/** A deep cave: a stone dome with ore-studded walls, dripstone, a lava pool at the back and torches. */
function buildCave(): Builder {
  const b = new Builder()
  const c = SIZE / 2
  const stone = b.id('stone')
  const deep = b.id('deepslate', { axis: 'y' })
  const air = 0
  const ores = [
    'coal_ore',
    'iron_ore',
    'copper_ore',
    'deepslate_diamond_ore',
    'deepslate_gold_ore',
    'deepslate_redstone_ore'
  ]
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot((x - c) * 0.9, z - c)
      const wall = 13 + (smoothNoise(x, z, 5, 81) - 0.5) * 6
      const ceil = Math.round(G + 9 - (d / wall) * 4 + (smoothNoise(x, z, 4, 83) - 0.5) * 4)
      for (let y = 0; y < HEIGHT; y++) {
        const inside = d < wall && y > G && y < ceil
        if (inside) continue
        const r = hash(x * 7 + y, z, 85)
        const ore =
          r < 0.035
            ? b.id(ores[Math.floor(hash(x, y * 3 + z, 86) * ores.length)], ores[0].includes('deepslate') ? {} : {})
            : 0
        b.set(x, y, z, ore || (y < G - 1 ? deep : stone))
      }
      // Stalactites hanging from the ceiling.
      if (d < wall - 2 && hash(x, z, 87) < 0.05) {
        b.set(
          x,
          ceil - 1,
          z,
          b.id('pointed_dripstone', { thickness: 'frustum', vertical_direction: 'down', waterlogged: 'false' })
        )
        b.set(
          x,
          ceil - 2,
          z,
          b.id('pointed_dripstone', { thickness: 'tip', vertical_direction: 'down', waterlogged: 'false' })
        )
      }
    }
  // Diamonds in reach of the stage, a lava pool at the back, torches around.
  for (const [dx, dy, dz] of [
    [-4, 1, -6],
    [-3, 2, -6],
    [-4, 2, -6]
  ])
    b.set(c + dx, G + dy, c + dz, b.id('diamond_ore'))
  for (let z = c - 11; z <= c - 7; z++)
    for (let x = c + 2; x <= c + 8; x++)
      if (Math.hypot(x - (c + 5), z - (c - 9)) < 3.2) b.set(x, G, z, b.id('lava', { level: '0' }))
  for (const [dx, dz] of [
    [-5, -3],
    [5, -1],
    [-2, 4],
    [6, 5]
  ])
    if (b.get(c + dx, G + 1, c + dz) === air) b.set(c + dx, G + 1, c + dz, b.id('torch'))
  return b
}

/** A nether ravine: two netherrack cliffs facing each other across a lava lake far below. */
function buildRavine(): Builder {
  const b = new Builder()
  const c = SIZE / 2
  const rack = b.id('netherrack')
  const basalt = b.id('basalt', { axis: 'y' })
  const black = b.id('blackstone')
  const lava = b.id('lava', { level: '0' })
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      // The gap runs along Z through the middle; its edges wobble a little.
      const half = 3 + (smoothNoise(x, z, 7, 91) - 0.5) * 2
      const edge = Math.abs(x - c + 0.5) - half
      const hills = Math.max(0, edge - 6) * 0.25 * smoothNoise(x, z, 9, 92)
      const top = edge < 0 ? 1 : Math.round(G + hills)
      for (let y = 0; y <= top; y++) {
        const r = hash(x, y * 5 + z, 93)
        b.set(
          x,
          y,
          z,
          y > top - 1 && edge >= 0
            ? r < 0.3
              ? b.id('crimson_nylium')
              : rack
            : r < 0.25
              ? basalt
              : r < 0.4
                ? black
                : rack
        )
      }
      if (edge < 0) for (let y = 2; y <= 3; y++) b.set(x, y, z, lava)
      // Lava falls down the far cliff faces.
      if (edge >= 0 && edge < 1 && hash(x, z, 94) < 0.03)
        for (let y = 4; y <= top; y++) b.set(x, y, z, b.id('magma_block'))
    }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash(i, 1, 95) * SIZE)
    const z = Math.floor(hash(i, 2, 96) * SIZE)
    if (Math.abs(x - c) > 9) b.set(x, G + 1, z, b.id(hash(i, 3, 97) < 0.5 ? 'crimson_roots' : 'crimson_fungus'))
  }
  return b
}

/**
 * A stone-brick watchtower (7×7, crenellated top) for "who's up there?" shots. Its base sits at y=0 of the
 * terrain; someone standing on top stands TOWER_TOP blocks up, at the object's centre.
 */
export const TOWER_TOP = 12
export function buildTower(): TerrainData {
  const b = new Builder()
  const brick = b.id('stone_bricks')
  const mossy = b.id('mossy_stone_bricks')
  const cracked = b.id('cracked_stone_bricks')
  const n = 7
  // Hollow walls, a floor whose top is at TOWER_TOP, and crenellations on the rim above it.
  for (let y = 0; y <= TOWER_TOP; y++)
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const rim = x === 0 || z === 0 || x === n - 1 || z === n - 1
        if (y === TOWER_TOP && !(rim && (x + z) % 2 === 0)) continue
        if (y < TOWER_TOP - 1 && !rim) continue
        const r = hash(x + y * 9, z, 98)
        b.set(x, y, z, r < 0.2 ? mossy : r < 0.3 ? cracked : brick)
      }
  // Window slits.
  for (const y of [4, 8]) {
    b.set(3, y, 0, 0)
    b.set(3, y, n - 1, 0)
  }
  return {
    sizeX: n,
    sizeY: TOWER_TOP + 1,
    sizeZ: n,
    originX: 0,
    originY: 0,
    originZ: 0,
    palette: b.palette,
    blocks: b.blocks.slice(0, n * n * (TOWER_TOP + 1)).map((_, i) => {
      const x = i % n
      const z = Math.floor(i / n) % n
      const y = Math.floor(i / (n * n))
      return b.get(x, y, z)
    }),
    biomePalette: ['minecraft:plains'],
    biomes: new Uint16Array(n * n),
    dimension: 'overworld'
  }
}

/**
 * A thick tree trunk (2×2 logs) rising out of frame: a foreground prop for "peeking from behind a tree"
 * shots. Its base sits at y=0 of the terrain, centred on the object's position.
 */
export function buildTrunk(log = 'dark_oak_log', height = 14): TerrainData {
  const palette: BlockState[] = [
    { name: 'minecraft:air', properties: {} },
    { name: `minecraft:${log}`, properties: { axis: 'y' } }
  ]
  return {
    sizeX: 2,
    sizeY: height,
    sizeZ: 2,
    originX: 0,
    originY: 0,
    originZ: 0,
    palette,
    blocks: new Uint16Array(2 * 2 * height).fill(1),
    biomePalette: ['minecraft:dark_forest'],
    biomes: new Uint16Array(4),
    dimension: 'overworld'
  }
}

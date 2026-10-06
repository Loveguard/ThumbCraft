// Types shared between the Electron main process, the preload bridge and the renderer.

export type Dimension = 'overworld' | 'the_nether' | 'the_end'

export interface BlockState {
  /** Namespaced id, e.g. "minecraft:grass_block". */
  name: string
  properties: Record<string, string>
}

/**
 * A box of real Minecraft blocks, read from region files that the vanilla game
 * (or the vanilla server we drive) generated. Nothing in here is synthesised.
 */
export interface TerrainData {
  sizeX: number
  sizeY: number
  sizeZ: number
  /** World coordinates of the box's minimum corner. */
  originX: number
  originY: number
  originZ: number
  palette: BlockState[]
  /** Palette index per block, laid out x + z*sizeX + y*sizeX*sizeZ. */
  blocks: Uint16Array
  /** Biome ids referenced by `biomes`. */
  biomePalette: string[]
  /** Biome palette index per column (x + z*sizeX), sampled at the column's surface. */
  biomes: Uint16Array
  dimension: Dimension
}

export interface BiomeInfo {
  id: string
  temperature: number
  downfall: number
  effects: {
    sky_color?: number
    fog_color?: number
    water_color?: number
    water_fog_color?: number
    grass_color?: number
    foliage_color?: number
    dry_foliage_color?: number
    grass_color_modifier?: 'none' | 'dark_forest' | 'swamp'
  }
}

/** Everything the renderer needs from the client jar, minus textures (served via mcasset://). */
export interface AssetBundle {
  version: string
  /** What this Minecraft version supports in ThumbCraft. */
  blockstates: Record<string, unknown>
  /** Keyed by model id without namespace, e.g. "block/stone". */
  models: Record<string, unknown>
  /** Keyed by biome id without namespace. */
  biomes: Record<string, BiomeInfo>
  /** Texture paths available, e.g. "block/stone". */
  textures: string[]
  /** Vanilla structure template ids, e.g. "village/plains/houses/plains_small_house_1". */
  structures: string[]
}

export interface SkinResult {
  username: string
  uuid: string
  model: 'classic' | 'slim'
  /** PNG as a data: URL. */
  skinDataUrl: string
  capeDataUrl?: string
}

export interface GenerateRequest {
  version: string
  seed: string
  dimension: Dimension
  biome: string
  /** Width/depth of the extracted area in blocks. */
  size: number
}

export interface GenerateProgress {
  stage: 'download' | 'start' | 'locate' | 'generate' | 'extract' | 'done' | 'error'
  message: string
}

export interface WorldImportRequest {
  worldDir: string
  dimension: Dimension
  centerX: number
  /** Optional height to slice around (otherwise the surface is followed). */
  centerY?: number
  centerZ: number
  size: number
}

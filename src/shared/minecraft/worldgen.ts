// Helpers for driving a vanilla dedicated server to generate real terrain.
import type { Dimension } from '../types'

export const NETHER_BIOMES = ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas']
/** Underground overworld biomes: we cut a window around the located Y instead of following the surface. */
export const CAVE_BIOMES = ['lush_caves', 'dripstone_caves', 'deep_dark']

/**
 * The biomes offered in the picker: one per distinct look rather than every variant (old-growth, windswept,
 * snowy-taiga and so on mostly differ in details a thumbnail never shows). In display order.
 */
const PICKER_BIOMES: Record<Dimension, string[]> = {
  overworld: [
    'plains',
    'cherry_grove',
    'dark_forest',
    'pale_garden',
    'taiga',
    'jungle',
    'swamp',
    'savanna',
    'desert',
    'badlands',
    'snowy_plains',
    'ice_spikes',
    'jagged_peaks',
    'mushroom_fields',
    'lush_caves',
    'deep_dark'
  ],
  the_nether: NETHER_BIOMES,
  the_end: ['the_end', 'end_highlands']
}

/** The picker's biomes that this version of the game has, grouped by dimension. */
export function groupBiomes(ids: string[]): Record<Dimension, string[]> {
  const have = new Set(ids)
  const pick = (d: Dimension): string[] => PICKER_BIOMES[d].filter((b) => have.has(b))
  return { overworld: pick('overworld'), the_nether: pick('the_nether'), the_end: pick('the_end') }
}

/**
 * Where a world keeps a dimension's region files: newer versions use dimensions/minecraft/<dimension>/region,
 * older ones region, DIM-1/region and DIM1/region. Newest layout first.
 */
export function regionDirs(dimension: Dimension): string[] {
  const legacy = dimension === 'the_nether' ? 'DIM-1/region' : dimension === 'the_end' ? 'DIM1/region' : 'region'
  return [`dimensions/minecraft/${dimension}/region`, legacy]
}

export interface LocateResult {
  biome: string
  x: number
  y: number | null
  z: number
}

/**
 * Parses the server's reply to `locate biome`, e.g.
 * "The nearest minecraft:desert is at [-1234, 72, 567] (1300 blocks away)".
 */
export function parseLocate(line: string): LocateResult | null {
  const m = /The nearest (\S+) is at \[(-?\d+), (~|-?\d+), (-?\d+)\]/.exec(line)
  if (!m) return null
  return { biome: m[1], x: Number(m[2]), y: m[3] === '~' ? null : Number(m[3]), z: Number(m[4]) }
}

export const isLocateFailure = (line: string): boolean => /Could not find a biome of type/i.test(line)

export const isServerReady = (line: string): boolean => /\]: Done \(\d/.test(line) || /: Done \(\d/.test(line)

/** Gamerules for the generator world: nothing ticks, burns or spawns (unknown names on older versions are ignored). */
export const SERVER_GAMERULES = [
  'spawnChunkRadius 0',
  'randomTickSpeed 0',
  'doFireTick false',
  'doDaylightCycle false',
  'doWeatherCycle false',
  'doMobSpawning false'
]

export function serverProperties(seed: string, port: number, levelName: string): string {
  return [
    `level-seed=${seed}`,
    `level-name=${levelName}`,
    `server-port=${port}`,
    // Only this computer may connect; the generator never needs the network.
    'server-ip=127.0.0.1',
    'online-mode=false',
    'enable-rcon=false',
    'enable-query=false',
    'motd=ThumbCraft terrain generator',
    'max-players=1',
    'view-distance=3',
    'simulation-distance=3',
    'spawn-protection=0',
    // A throwaway cache world: don't fsync every chunk on save.
    'sync-chunk-writes=false',
    'region-file-compression=deflate',
    'max-tick-time=-1',
    'generate-structures=true',
    'white-list=true',
    ''
  ].join('\n')
}

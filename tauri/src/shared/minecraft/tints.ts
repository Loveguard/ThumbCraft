// Biome colours, reproducing vanilla's BlockColors / GrassColor / FoliageColor behaviour.
// The colormap images and biome climate values come from the user's client jar.
import type { BiomeInfo } from '../types'
import { stripNs } from './blockModel'

export interface Colormap {
  width: number
  height: number
  /** RGBA bytes */
  data: Uint8Array | Uint8ClampedArray
}

const FALLBACK_GRASS = 0x91bd59
const FALLBACK_FOLIAGE = 0x77ab2f
const FALLBACK_WATER = 0x3f76e4

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Same lookup as vanilla GrassColor.get / FoliageColor.get. */
export function sampleColormap(map: Colormap | null, temperature: number, downfall: number, fallback: number): number {
  if (!map) return fallback
  const t = clamp01(temperature)
  const d = clamp01(downfall) * t
  const x = Math.floor((1 - t) * 255)
  const y = Math.floor((1 - d) * 255)
  if (x >= map.width || y >= map.height) return fallback
  const i = (y * map.width + x) * 4
  return (map.data[i] << 16) | (map.data[i + 1] << 8) | map.data[i + 2]
}

export interface Colormaps {
  grass: Colormap | null
  foliage: Colormap | null
}

export function grassColor(biome: BiomeInfo | undefined, maps: Colormaps): number {
  if (!biome) return FALLBACK_GRASS
  let c = biome.effects.grass_color ?? sampleColormap(maps.grass, biome.temperature, biome.downfall, FALLBACK_GRASS)
  switch (biome.effects.grass_color_modifier) {
    case 'dark_forest':
      c = ((c & 0xfefefe) + 0x28340a) >> 1
      break
    case 'swamp':
      // Vanilla picks 0x4C763C or 0x6A7039 from a world-position noise; we use the dominant one.
      c = 0x6a7039
      break
  }
  return c
}

export function foliageColor(biome: BiomeInfo | undefined, maps: Colormaps): number {
  if (!biome) return FALLBACK_FOLIAGE
  return (
    biome.effects.foliage_color ?? sampleColormap(maps.foliage, biome.temperature, biome.downfall, FALLBACK_FOLIAGE)
  )
}

export function waterColor(biome: BiomeInfo | undefined): number {
  return biome?.effects.water_color ?? FALLBACK_WATER
}

type TintKind = 'grass' | 'foliage' | 'water' | number | ((props: Record<string, string>) => number)

/** Vanilla BlockColors for pumpkin and melon stems: green when young, yellowing as they grow. */
const stemColor = (age: number): number => ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4)

/** Blocks vanilla tints via BlockColors (tintindex >= 0 faces only). */

const TINTED: Record<string, TintKind> = {
  pumpkin_stem: (p) => stemColor(Number(p.age ?? 0)),
  melon_stem: (p) => stemColor(Number(p.age ?? 0)),
  attached_pumpkin_stem: 0xe0c71c,
  attached_melon_stem: 0xe0c71c,
  grass_block: 'grass',
  short_grass: 'grass',
  grass: 'grass',
  tall_grass: 'grass',
  fern: 'grass',
  large_fern: 'grass',
  potted_fern: 'grass',
  sugar_cane: 'grass',
  bush: 'grass',
  oak_leaves: 'foliage',
  jungle_leaves: 'foliage',
  acacia_leaves: 'foliage',
  dark_oak_leaves: 'foliage',
  mangrove_leaves: 'foliage',
  vine: 'foliage',
  birch_leaves: 0x80a755,
  spruce_leaves: 0x619961,
  lily_pad: 0x208030,
  water: 'water',
  bubble_column: 'water',
  water_cauldron: 'water',
  redstone_wire: (p) => redstoneColor(Number(p.power ?? 0))
}

export function redstoneColor(power: number): number {
  const f = power / 15
  const r = f * 0.6 + (f > 0 ? 0.4 : 0.3)
  const g = clamp01(f * f * 0.7 - 0.5)
  const b = clamp01(f * f * 0.6 - 0.7)
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)
}

export interface BiomeColors {
  grass: number
  foliage: number
  water: number
}

/** RGB tint for a face, or 0xFFFFFF when the block is untinted. */
export function blockTint(
  blockName: string,
  props: Record<string, string>,
  tintindex: number,
  colors: BiomeColors
): number {
  if (tintindex < 0) return 0xffffff
  const kind = TINTED[stripNs(blockName)]
  if (kind === undefined) return 0xffffff
  if (typeof kind === 'number') return kind
  if (typeof kind === 'function') return kind(props)
  return colors[kind]
}

/** Averages colours over a (2r+1)^2 neighbourhood, like vanilla's biome blend option (default r=2). */
export function blendColors(get: (dx: number, dz: number) => number, radius: number): number {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      const c = get(dx, dz)
      if (c < 0) continue
      r += (c >> 16) & 255
      g += (c >> 8) & 255
      b += c & 255
      n++
    }
  if (!n) return get(0, 0)
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
}

/** Face brightness by direction (vanilla Level#getShade). The Nether uses constant ambient light. */
export function faceShade(dir: string, shade: boolean, netherLighting: boolean): number {
  if (!shade) return netherLighting ? 0.9 : 1
  switch (dir) {
    case 'down':
      return netherLighting ? 0.9 : 0.5
    case 'up':
      return netherLighting ? 0.9 : 1
    case 'north':
    case 'south':
      return 0.8
    default:
      return 0.6
  }
}

// What a biome's surface typically looks like, for preview cards: the top block, what's under it, water and
// trees. Based on the vanilla surface rules and tree features per biome family (a preview, not the generator).

export type Tint = 'grass' | 'foliage' | number | null

export interface BiomeLook {
  /** Side texture of the surface block, and an optional tinted overlay drawn on it (grass). */
  top: string
  overlay?: { texture: string; tint: Tint }
  filler: string
  water: boolean
  trees?: { log: string; leaves: string; tint: Tint; count: number; tall?: boolean }
}

const tree = (wood: string, tint: Tint, count: number, tall = false): BiomeLook['trees'] => ({
  log: `block/${wood}_log`,
  leaves: `block/${wood}_leaves`,
  tint,
  count,
  tall
})

const GRASS: Pick<BiomeLook, 'top' | 'overlay' | 'filler'> = {
  top: 'block/grass_block_side',
  overlay: { texture: 'block/grass_block_side_overlay', tint: 'grass' },
  filler: 'block/dirt'
}

export function biomeLook(id: string): BiomeLook {
  const has = (...words: string[]): boolean => words.some((w) => id.includes(w))
  // Nether and End.
  if (id === 'nether_wastes') return { top: 'block/netherrack', filler: 'block/netherrack', water: false }
  if (id === 'crimson_forest')
    return {
      top: 'block/crimson_nylium_side',
      filler: 'block/netherrack',
      water: false,
      trees: { log: 'block/crimson_stem', leaves: 'block/nether_wart_block', tint: null, count: 3, tall: true }
    }
  if (id === 'warped_forest')
    return {
      top: 'block/warped_nylium_side',
      filler: 'block/netherrack',
      water: false,
      trees: { log: 'block/warped_stem', leaves: 'block/warped_wart_block', tint: null, count: 3, tall: true }
    }
  if (id === 'soul_sand_valley') return { top: 'block/soul_sand', filler: 'block/soul_soil', water: false }
  if (id === 'basalt_deltas') return { top: 'block/basalt_side', filler: 'block/blackstone', water: false }
  if (has('end')) return { top: 'block/end_stone', filler: 'block/end_stone', water: false }
  // Caves.
  if (id === 'deep_dark') return { top: 'block/sculk', filler: 'block/deepslate', water: false }
  if (id === 'dripstone_caves') return { top: 'block/dripstone_block', filler: 'block/stone', water: false }
  if (id === 'lush_caves') return { top: 'block/moss_block', filler: 'block/stone', water: false }
  // Water.
  if (has('ocean')) return { top: 'block/sand', filler: 'block/gravel', water: true }
  if (has('river')) return { top: 'block/sand', filler: 'block/dirt', water: true }
  if (id === 'stony_shore') return { top: 'block/stone', filler: 'block/stone', water: true }
  if (has('beach')) return { top: has('snowy') ? 'block/snow' : 'block/sand', filler: 'block/sandstone', water: true }
  // Dry lands.
  if (has('badlands'))
    return {
      top: 'block/red_sand',
      filler: 'block/orange_terracotta',
      water: false,
      trees: has('wooded') ? tree('oak', 'foliage', 2) : undefined
    }
  if (has('desert')) return { top: 'block/sand', filler: 'block/sandstone', water: false }
  if (id === 'mushroom_fields') return { top: 'block/mycelium_side', filler: 'block/dirt', water: false }
  // Mountains and snow.
  if (has('frozen_peaks', 'ice_spikes')) return { top: 'block/packed_ice', filler: 'block/stone', water: false }
  if (has('jagged_peaks', 'snowy_slopes')) return { top: 'block/snow', filler: 'block/stone', water: false }
  if (id === 'stony_peaks' || has('gravelly')) return { top: 'block/stone', filler: 'block/stone', water: false }
  if (id === 'grove')
    return {
      top: 'block/grass_block_snow',
      filler: 'block/dirt',
      water: false,
      trees: tree('spruce', 0x619961, 4, true)
    }
  if (has('snowy', 'frozen'))
    return {
      top: 'block/grass_block_snow',
      filler: 'block/dirt',
      water: false,
      trees: has('taiga') ? tree('spruce', 0x619961, 3, true) : undefined
    }
  // Forests and the rest of the green world.
  if (has('mangrove'))
    return { top: 'block/mud', filler: 'block/mud', water: true, trees: tree('mangrove', 'foliage', 3) }
  if (has('swamp')) return { ...GRASS, water: true, trees: tree('oak', 'foliage', 2) }
  if (has('cherry')) return { ...GRASS, water: false, trees: tree('cherry', null, 3) }
  if (has('old_growth') && has('taiga'))
    return { top: 'block/podzol_side', filler: 'block/dirt', water: false, trees: tree('spruce', 0x619961, 4, true) }
  if (has('taiga')) return { ...GRASS, water: false, trees: tree('spruce', 0x619961, 4, true) }
  if (has('jungle')) return { ...GRASS, water: false, trees: tree('jungle', 'foliage', has('sparse') ? 2 : 4, true) }
  if (has('dark_forest')) return { ...GRASS, water: false, trees: tree('dark_oak', 'foliage', 5) }
  if (has('birch')) return { ...GRASS, water: false, trees: tree('birch', 0x80a755, 4, has('old_growth')) }
  if (has('savanna')) return { ...GRASS, water: false, trees: tree('acacia', 'foliage', 2) }
  if (has('forest', 'windswept_forest')) return { ...GRASS, water: false, trees: tree('oak', 'foliage', 4) }
  if (has('meadow', 'plains', 'sunflower', 'windswept_hills', 'pale'))
    return { ...GRASS, water: false, trees: tree('oak', 'foliage', 1) }
  return { ...GRASS, water: false }
}

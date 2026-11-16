// Vanilla-style lighting: block light spreads out from glowing blocks and sky light from the open sky, losing
// one level per block (more through leaves and water), and the lightmap turns (sky, block) levels into a
// colour exactly like the game's LightTexture (warm torch light, darker at night).

type Props = Record<string, string>
const lit = (p: Props, level: number): number => (p.lit === 'false' ? 0 : level)
const copperBulb = (level: number) => (p: Props) => lit(p, level)

/** Light emitted per block (vanilla Blocks.java `lightLevel`), by block id; functions read the block state. */
const EMISSION: Record<string, number | ((p: Props) => number)> = {
  torch: 14,
  wall_torch: 14,
  soul_torch: 10,
  soul_wall_torch: 10,
  redstone_torch: (p) => lit(p, 7),
  redstone_wall_torch: (p) => lit(p, 7),
  lantern: 15,
  soul_lantern: 10,
  glowstone: 15,
  sea_lantern: 15,
  shroomlight: 15,
  jack_o_lantern: 15,
  beacon: 15,
  conduit: 15,
  end_rod: 14,
  lava: 15,
  fire: 15,
  soul_fire: 10,
  campfire: (p) => lit(p, 15),
  soul_campfire: (p) => lit(p, 10),
  redstone_lamp: (p) => (p.lit === 'true' ? 15 : 0),
  copper_bulb: copperBulb(15),
  exposed_copper_bulb: copperBulb(12),
  weathered_copper_bulb: copperBulb(8),
  oxidized_copper_bulb: copperBulb(4),
  waxed_copper_bulb: copperBulb(15),
  waxed_exposed_copper_bulb: copperBulb(12),
  waxed_weathered_copper_bulb: copperBulb(8),
  waxed_oxidized_copper_bulb: copperBulb(4),
  ochre_froglight: 15,
  verdant_froglight: 15,
  pearlescent_froglight: 15,
  glow_lichen: 7,
  crying_obsidian: 10,
  magma_block: 3,
  respawn_anchor: (p) => [0, 3, 7, 11, 15][Number(p.charges ?? 0)] ?? 0,
  sea_pickle: (p) => (p.waterlogged === 'false' ? 0 : 3 + 3 * Number(p.pickles ?? 1)),
  amethyst_cluster: 5,
  large_amethyst_bud: 4,
  medium_amethyst_bud: 2,
  small_amethyst_bud: 1,
  brewing_stand: 1,
  brown_mushroom: 1,
  dragon_egg: 1,
  end_portal_frame: 1,
  sculk_sensor: 1,
  calibrated_sculk_sensor: 1,
  sculk_catalyst: 6,
  enchanting_table: 7,
  ender_chest: 7,
  nether_portal: 11,
  end_portal: 15,
  end_gateway: 15,
  furnace: (p) => (p.lit === 'true' ? 13 : 0),
  blast_furnace: (p) => (p.lit === 'true' ? 13 : 0),
  smoker: (p) => (p.lit === 'true' ? 13 : 0),
  redstone_ore: (p) => (p.lit === 'true' ? 9 : 0),
  deepslate_redstone_ore: (p) => (p.lit === 'true' ? 9 : 0),
  cave_vines: (p) => (p.berries === 'true' ? 14 : 0),
  cave_vines_plant: (p) => (p.berries === 'true' ? 14 : 0),
  light: (p) => Number(p.level ?? 15)
}

export function lightEmission(name: string, props: Props): number {
  const id = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
  const e = EMISSION[id]
  if (e !== undefined) return typeof e === 'number' ? e : e(props)
  // Candles and candle cakes: 3 per lit candle.
  if (id.endsWith('candle')) return p(props.lit) ? 3 * Number(props.candles ?? 1) : 0
  if (id.endsWith('candle_cake')) return p(props.lit) ? 3 : 0
  return 0
}
const p = (v: string | undefined): boolean => v === 'true'

export interface LightVolume {
  sky: Uint8Array
  block: Uint8Array
}

/**
 * Flood-fills sky and block light through a box of blocks (indexed x + z*sx + y*sx*sz).
 * `opacity(i)` is vanilla's light block value per palette index: 15 for solid blocks, 1 for leaves and
 * water, 0 for air and open shapes. Sky light enters from the top of the box (none when `hasSky` is false).
 */
export function computeLight(
  sx: number,
  sy: number,
  sz: number,
  blocks: ArrayLike<number>,
  opacity: (paletteIndex: number) => number,
  emission: (paletteIndex: number) => number,
  hasSky: boolean
): LightVolume {
  const n = sx * sy * sz
  const sky = new Uint8Array(n)
  const block = new Uint8Array(n)
  const op = new Uint8Array(n)
  for (let i = 0; i < n; i++) op[i] = opacity(blocks[i])
  // Cells can be improved more than once when several sources overlap, so the queue grows as needed.
  let queue: number[] = []

  const spread = (light: Uint8Array): void => {
    let head = 0
    while (head < queue.length) {
      const i = queue[head++]
      const level = light[i]
      if (level <= 1) continue
      const x = i % sx
      const z = Math.floor(i / sx) % sz
      const y = Math.floor(i / (sx * sz))
      const visit = (j: number): void => {
        if (op[j] >= 15) return
        const next = level - Math.max(1, op[j])
        if (next > light[j]) {
          light[j] = next
          queue.push(j)
        }
      }
      if (x > 0) visit(i - 1)
      if (x < sx - 1) visit(i + 1)
      if (z > 0) visit(i - sx)
      if (z < sz - 1) visit(i + sx)
      if (y > 0) visit(i - sx * sz)
      if (y < sy - 1) visit(i + sx * sz)
    }
  }

  if (hasSky) {
    // Full-strength sky light falls straight down through open blocks without fading.
    queue = []
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        let level = 15
        for (let y = sy - 1; y >= 0 && level > 0; y--) {
          const i = x + z * sx + y * sx * sz
          if (op[i] >= 15) break
          if (op[i] > 0 || level < 15) level -= Math.max(1, op[i])
          if (level <= 0) break
          sky[i] = level
          queue.push(i)
        }
      }
    spread(sky)
  }

  queue = []
  for (let i = 0; i < n; i++) {
    const e = emission(blocks[i])
    if (e > 0) {
      block[i] = e
      queue.push(i)
    }
  }
  // Solid emitters (glowstone) keep their level but light only their neighbours.
  spread(block)
  return { sky, block }
}

export type LightDimension = 'overworld' | 'the_nether' | 'the_end'

/**
 * The game's lightmap (LightTexture.updateLightTexture) as 16×16 RGBA: x = block light, y = sky light.
 * `skyDarken` is 1 at noon and 0.2 at midnight; `gamma` is the Brightness option (default 0.5, "Moody" 0).
 */
export function vanillaLightmap(skyDarken: number, dimension: LightDimension, gamma = 0.5): Uint8Array {
  const ambient = dimension === 'the_nether' ? 0.1 : 0
  const brightness = (level: number): number => {
    const f = level / 15
    const curved = f / (4 - 3 * f)
    return ambient + (1 - ambient) * curved
  }
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  const notGamma = (v: number): number => 1 - Math.pow(1 - v, 4)
  const skyFactor = skyDarken * 0.95 + 0.05
  const skyColor = [skyDarken, skyDarken, 1].map((c) => c + (1 - c) * 0.35)
  const out = new Uint8Array(16 * 16 * 4)
  for (let s = 0; s < 16; s++)
    for (let b = 0; b < 16; b++) {
      const sky = brightness(s) * skyFactor
      const bl = brightness(b) * 1.5 // flicker-free torch light
      let c = [bl, bl * ((bl * 0.6 + 0.4) * 0.6 + 0.4), bl * (bl * bl * 0.6 + 0.4)]
      if (dimension === 'the_end') {
        c = c.map((v, k) => clamp(v + ([0.99, 1.12, 1.0][k] - v) * 0.25))
      } else {
        c = c.map((v, k) => v + skyColor[k] * sky)
        c = c.map((v) => v + (0.75 - v) * 0.04)
      }
      c = c.map(clamp)
      c = c.map((v) => v + (notGamma(v) - v) * gamma)
      c = c.map((v) => clamp(v + (0.75 - v) * 0.04))
      const o = (s * 16 + b) * 4
      out[o] = Math.round(c[0] * 255)
      out[o + 1] = Math.round(c[1] * 255)
      out[o + 2] = Math.round(c[2] * 255)
      out[o + 3] = 255
    }
  return out
}

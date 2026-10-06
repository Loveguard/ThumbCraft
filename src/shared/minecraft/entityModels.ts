// Entity (mob) models exported from the game's own LayerDefinitions by tools/model-dumper.

export interface DumpedQuad {
  /** Face normal in model space. */
  n: [number, number, number]
  /** Vertices: [x, y, z, u, v] — position in model pixels (y down), UV normalised to the texture. */
  v: [number, number, number, number, number][]
}

export interface DumpedPart {
  /** Joint position in model pixels. */
  pivot: [number, number, number]
  /** Radians, applied Z·Y·X like vanilla ModelPart. */
  rot: [number, number, number]
  scale: [number, number, number]
  visible: boolean
  quads: DumpedQuad[]
  children: Record<string, DumpedPart>
}

export interface DumpedLayer {
  /** Texture size the UVs were authored for. */
  texture: [number, number]
  root: DumpedPart
}

export interface MobModels {
  version: string
  /** Keyed by model layer location, e.g. "minecraft:zombie#main". */
  layers: Record<string, DumpedLayer>
  /** Size of every entity texture in the jar, keyed by path like "entity/zombie/zombie". */
  textureSizes: Record<string, [number, number]>
}

export const layerModel = (key: string): string => key.replace(/^minecraft:/, '').split('#')[0]
export const layerName = (key: string): string => key.split('#')[1] ?? 'main'

export type EntityCategory = 'mobs' | 'bosses' | 'blocks' | 'vehicles' | 'gear' | 'effects'

export const ENTITY_CATEGORIES: { id: EntityCategory; label: string }[] = [
  { id: 'mobs', label: 'Mobs' },
  { id: 'bosses', label: 'Bosses' },
  { id: 'blocks', label: 'Blocks & decor' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'gear', label: 'Gear & items' },
  { id: 'effects', label: 'Projectiles & effects' }
]

const BOSSES = /^(ender_dragon|wither|elder_guardian|warden)$/
const BLOCKS =
  /^(chest|double_chest|trapped_chest|ender_chest|bed|sign|hanging_sign|wall_hanging_sign|banner|wall_banner|bell|book|conduit|decorated_pot|skull|player_head|head|shulker_box|lectern|enchanting|copper_golem_statue|chest_left|chest_right)|(_chest|_sign|_banner|_head|_skull|_pot|_bed)(_|$)|^(standing|wall)_/
const VEHICLES = /(^|_)(boat|raft|minecart)(_|$)/
const GEAR =
  /^(trident|shield|elytra|armor_stand|end_crystal|spyglass|wolf_armor|horse_armor|llama_decor)|(_armor|armor)$/
const EFFECTS =
  /^(arrow|spectral_arrow|llama_spit|shulker_bullet|wind_charge|breeze_wind|evoker_fangs|leash_knot|spin_attack|fireball|dragon_fireball|wither_skull|fishing_bobber|firework|trident_riptide|ominous_item_spawner)/

/** Which shelf of the entity browser a model belongs on (by its model layer name). */
export function entityCategory(layerKey: string): EntityCategory {
  const m = layerModel(layerKey)
  const base = m.split('/')[0] // e.g. "boat/oak" -> "boat", "sign/birch" -> "sign"
  if (BOSSES.test(base)) return 'bosses'
  if (VEHICLES.test(base)) return 'vehicles'
  if (EFFECTS.test(base)) return 'effects'
  if (GEAR.test(base)) return 'gear'
  if (BLOCKS.test(base)) return 'blocks'
  return 'mobs'
}

/**
 * The texture each vanilla renderer uses, for models whose texture isn't named after the model (magma cube
 * → slime/magmacube, ender dragon → enderdragon/dragon, mob heads → the mob's own skin…). Several paths
 * cover renames between versions; the first one the jar has wins.
 */
const KNOWN_TEXTURES: Record<string, string[]> = {
  magma_cube: ['entity/slime/magmacube'],
  ender_dragon: ['entity/enderdragon/dragon'],
  dragon_head: ['entity/enderdragon/dragon'],
  dragon_skull: ['entity/enderdragon/dragon'],
  end_crystal: ['entity/end_crystal/end_crystal'],
  shield: ['entity/shield/base_nopattern', 'entity/shield_base_nopattern'],
  armor_stand: ['entity/armorstand/wood', 'entity/armorstand/armorstand'],
  armor_stand_small: ['entity/armorstand/wood', 'entity/armorstand/armorstand'],
  decorated_pot: ['entity/decorated_pot/decorated_pot_base'],
  decorated_pot_base: ['entity/decorated_pot/decorated_pot_base'],
  decorated_pot_sides: ['entity/decorated_pot/decorated_pot_side'],
  zombie_head: ['entity/zombie/zombie'],
  skeleton_skull: ['entity/skeleton/skeleton'],
  wither_skeleton_skull: ['entity/skeleton/wither_skeleton'],
  creeper_head: ['entity/creeper/creeper'],
  piglin_head: ['entity/piglin/piglin'],
  player_head: ['entity/player/wide/steve'],
  wolf_armor: ['entity/wolf/wolf_armor'],
  llama: ['entity/llama/creamy'],
  trader_llama: ['entity/llama/creamy'],
  pufferfish_big: ['entity/fish/pufferfish'],
  pufferfish_medium: ['entity/fish/pufferfish'],
  pufferfish_small: ['entity/fish/pufferfish'],
  tropical_fish_small: ['entity/fish/tropical_a'],
  tropical_fish_large: ['entity/fish/tropical_b'],
  cod: ['entity/fish/cod'],
  salmon: ['entity/fish/salmon'],
  dolphin: ['entity/dolphin'],
  squid: ['entity/squid/squid'],
  glow_squid: ['entity/squid/glow_squid'],
  turtle: ['entity/turtle/big_sea_turtle'],
  guardian: ['entity/guardian'],
  elder_guardian: ['entity/guardian_elder'],
  axolotl: ['entity/axolotl/axolotl_lucy'],
  tadpole: ['entity/tadpole/tadpole'],
  frog: ['entity/frog/temperate_frog'],
  giant: ['entity/zombie/zombie'],
  piglin: ['entity/piglin/piglin'],
  piglin_brute: ['entity/piglin/piglin_brute'],
  zombified_piglin: ['entity/piglin/zombified_piglin'],
  hoglin: ['entity/hoglin/hoglin'],
  zoglin: ['entity/hoglin/zoglin'],
  iron_golem: ['entity/iron_golem/iron_golem'],
  snow_golem: ['entity/snow_golem'],
  mooshroom: ['entity/cow/red_mooshroom', 'entity/cow/mooshroom'],
  wither: ['entity/wither/wither'],
  warden: ['entity/warden/warden'],
  trident: ['entity/trident'],
  elytra: ['entity/elytra'],
  book: ['entity/enchanting_table_book'],
  chest: ['entity/chest/normal'],
  double_chest: ['entity/chest/normal'],
  ender_chest: ['entity/chest/ender'],
  bell: ['entity/bell/bell_body'],
  conduit: ['entity/conduit/base']
}

/** Layers that are only pieces of another model (drawn together by the game), not things to place alone. */
export const HIDDEN_LAYERS =
  /^(bee_stinger|happy_ghast_ropes|double_chest_left|double_chest_right|chest_left|chest_right)$/

/**
 * Entity textures the game could pair with this model, best first. The pairing itself lives in each
 * renderer's Java code, so we rank the jar's real textures by matching name and exact UV size.
 */
export function textureCandidates(
  layerKey: string,
  layer: DumpedLayer,
  sizes: Record<string, [number, number]>
): string[] {
  const model = layerModel(layerKey)
  const tokens = model.split('_')
  const [tw, th] = layer.texture
  const scored: { path: string; score: number }[] = []
  // What the game's renderer really uses comes first: the table above, then the texture at the model's own
  // path (entity/boat/oak for "boat/oak"), when its proportions fit the model.
  const base = model.replace(/_baby$/, '')
  const known = [
    ...(KNOWN_TEXTURES[model] ?? KNOWN_TEXTURES[base] ?? []),
    `entity/${model}`,
    `entity/${base}/${base}`,
    `entity/${base}`
  ].filter((p, i, all) => sizes[p] && sizes[p][0] * th === sizes[p][1] * tw && all.indexOf(p) === i)
  for (const [path, [w, h]] of Object.entries(sizes)) {
    if (known.includes(path)) continue
    // Same aspect ratio as the model's UV space (textures may be higher resolution).
    if (w * th !== h * tw) continue
    const parts = path.split('/')
    const base = parts[parts.length - 1]
    let score = 0
    if (base === model) score = 100
    else if (parts.includes(model) && base.endsWith(model)) score = 90
    else if (parts.includes(model)) score = 70
    else if (base.includes(model)) score = 60
    else score = tokens.filter((t) => parts.some((p) => p.split('_').includes(t))).length * 10
    if (score > 0) scored.push({ path, score: score - parts.length * 0.1 })
  }
  return [...known, ...scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).map((s) => s.path)]
}

/** Every part path in a model, e.g. ["head", "head/hat", "body", …], for the pose editor. */
export function partPaths(part: DumpedPart, prefix = ''): string[] {
  const out: string[] = []
  for (const [name, child] of Object.entries(part.children)) {
    const path = prefix ? `${prefix}/${name}` : name
    out.push(path, ...partPaths(child, path))
  }
  return out
}

// ---------------------------------------------------------------- obfuscation mappings

/** Names the dumper looks up reflectively, as owner → members (Mojang's official names). */
export const DUMPER_NAMES: Record<string, string[]> = {
  'net.minecraft.SharedConstants': ['tryDetectVersion'],
  'net.minecraft.server.Bootstrap': ['bootStrap'],
  'net.minecraft.client.model.geom.LayerDefinitions': ['createRoots'],
  'net.minecraft.client.model.geom.builders.LayerDefinition': ['bakeRoot', 'material'],
  'net.minecraft.client.model.geom.builders.MaterialDefinition': ['xTexSize', 'yTexSize'],
  'net.minecraft.client.model.geom.ModelPart': [
    'x',
    'y',
    'z',
    'xRot',
    'yRot',
    'zRot',
    'xScale',
    'yScale',
    'zScale',
    'visible',
    'cubes',
    'children'
  ],
  'net.minecraft.client.model.geom.ModelPart$Cube': ['polygons'],
  'net.minecraft.client.model.geom.ModelPart$Polygon': ['vertices', 'normal'],
  'net.minecraft.client.model.geom.ModelPart$Vertex': ['pos', 'x', 'y', 'z', 'u', 'v']
}

/**
 * Builds the dumper's names.properties from Mojang's official ProGuard mappings (client_mappings.txt),
 * so the same dumper works on obfuscated releases. Only no-argument methods are considered.
 */
export function namesFromMappings(mappings: string): string {
  const wanted = new Map(Object.entries(DUMPER_NAMES).map(([k, v]) => [k, new Set(v)]))
  const lines: string[] = []
  let owner: string | null = null
  for (const raw of mappings.split(/\r?\n/)) {
    if (!raw || raw.startsWith('#')) continue
    if (!raw.startsWith(' ')) {
      const m = /^(\S+) -> (\S+):$/.exec(raw)
      owner = m && wanted.has(m[1]) ? m[1] : null
      if (m && owner) lines.push(`class.${owner}=${m[2]}`)
      continue
    }
    if (!owner) continue
    const m = /^\s+(?:\d+:\d+:)?(\S+) ([^\s(]+)(\([^)]*\))?(?::\d+:\d+)? -> (\S+)$/.exec(raw)
    if (!m) continue
    const [, , name, params, obf] = m
    if (params !== undefined && params !== '()') continue
    if (wanted.get(owner)!.has(name)) lines.push(`member.${owner}.${name}=${obf}`)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- mob pose presets

type Rot = [number, number, number]

/**
 * Ready-made poses for any mob, built from its part names (vanilla names them head, right_arm,
 * left_hind_leg, right_wing, tail, jaw…). Degrees, added to the model's own pose; model space has Y down,
 * so +X tips a head down and -X swings a limb forward. Only poses that move at least one part are offered.
 */
export function mobPosePresets(paths: string[]): { label: string; rotations: Record<string, Rot> }[] {
  const leaf = (p: string): string => p.split('/').pop()!
  const find = (re: RegExp): string[] => paths.filter((p) => re.test(leaf(p)))
  const side = (p: string): number => (/(^|_)left/.test(leaf(p)) ? -1 : 1)
  const front = (p: string): boolean => /front/.test(leaf(p)) || !/hind|back/.test(leaf(p))
  const legs = find(/^(right|left)_(front_|hind_|back_|middle_)?leg(_?\d+)?$/)
  const arms = find(/^(right|left)_arm$/)
  const heads = find(/^head$/)
  const wings = find(/^(right|left)_wing$/)
  const jaws = find(/^(jaw|mouth|lower_jaw)$/)
  const tails = find(/^tail(_?\d+)?$/)

  // Alternating gait: right-front with left-hind, like a real walk cycle.
  const gait = (deg: number): Record<string, Rot> => {
    const out: Record<string, Rot> = {}
    for (const p of legs) out[p] = [deg * side(p) * (front(p) ? 1 : -1), 0, 0]
    for (const p of arms) out[p] = [-deg * side(p), 0, 0]
    return out
  }
  const each = (list: string[], rot: (p: string) => Rot): Record<string, Rot> =>
    Object.fromEntries(list.map((p) => [p, rot(p)]))

  // Each pose is offered only when the mob has the parts it is about.
  const presets: { label: string; needs: string[]; rotations: Record<string, Rot> }[] = [
    { label: 'Walk', needs: legs, rotations: gait(25) },
    { label: 'Run', needs: legs, rotations: { ...gait(45), ...each(heads, () => [8, 0, 0]) } },
    {
      label: 'Reach',
      needs: arms,
      rotations: { ...each(arms, (p) => [-90, 0, -8 * side(p)]), ...each(heads, () => [5, 0, 0]) }
    },
    { label: 'Look up', needs: heads, rotations: each(heads, () => [-30, 0, 0]) },
    { label: 'Look down', needs: heads, rotations: each(heads, () => [25, 0, 0]) },
    { label: 'Turn head', needs: heads, rotations: each(heads, () => [0, 35, 0]) },
    { label: 'Wings up', needs: wings, rotations: each(wings, (p) => [0, 0, 40 * side(p)]) },
    { label: 'Wings down', needs: wings, rotations: each(wings, (p) => [0, 0, -30 * side(p)]) },
    { label: 'Mouth open', needs: jaws, rotations: each(jaws, () => [28, 0, 0]) },
    { label: 'Tail up', needs: tails, rotations: each(tails, () => [-35, 0, 0]) }
  ]
  return presets.filter((p) => p.needs.length > 0).map(({ label, rotations }) => ({ label, rotations }))
}

/** The parts worth showing first: top-level heads, bodies, limbs, wings and tails (tips and details go last). */
export function mainParts(paths: string[]): string[] {
  return paths.filter(
    (p) => !p.includes('/') && /^(head|body|neck|jaw|tail|(right|left)_(front_|hind_|back_)?(arm|leg|wing))$/.test(p)
  )
}

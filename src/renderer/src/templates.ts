// Ready-made thumbnail layouts: an instant backdrop, posed players, title text, sky, lighting and a look,
// framed by a saved camera shot. Everything is a normal scene object afterwards, so users just edit the text
// and swap in their own skin.
import { buildTower, buildTrunk, TOWER_TOP, type BackdropId } from '@shared/minecraft/backdrops'
import { ruinBlocks, scrambleBlocks } from '@shared/minecraft/props'
import type { TerrainData } from '@shared/types'
import { VFX_PRESETS, type VfxType } from './vfx'
import * as THREE from 'three'
import { textureCandidates, type MobModels } from '@shared/minecraft/entityModels'
import { POSES } from '@shared/minecraft/playerModel'
import { lookSettings, type LookId } from './grading'
import { assetUrl } from './minecraft/assets'
import { defaultSkinUrl } from './minecraft/builders'
import { mobModels } from './minecraft/mobs'
import { aimAt } from './lights'
import { errorText } from './errors'
import { registerMedia } from './media'
import { newProject } from './project'
import { flushAutosave, markClean } from './projectActions'
import { frameTransform } from './placement'
import { addTerrain, applyReadyMadeBiome } from './sceneActions'
import {
  cameraBridge,
  DEFAULT_SKY,
  NIGHT_LIGHTING,
  NO_EQUIPMENT,
  NO_EFFECTS,
  newId,
  useStore,
  type CameraState,
  type EffectSettings,
  type Equipment,
  type SceneSettings,
  type SkyPreset,
  type Vec3
} from './store'
import { FONTS, TEXT_STYLES } from './textStyles'
import { STICKERS, type StickerShape } from './stickers'
import SECRET_ANCHORS from '../../../resources/secret/anchors.json'

interface PlayerSpec {
  name: string
  /** One of the game's default skins (steve, alex, kai, noor…); Steve or Alex when this version lacks it. */
  skin?: string
  slim?: boolean
  pose: keyof typeof POSES
  at: Vec3
  /** Turn in degrees (0 faces the camera). */
  yaw: number
  equipment?: Partial<Equipment>
  scale?: number
  /** Fetch this Minecraft account's skin once the scene is up (keeps the default skin if it fails). */
  username?: string
}

interface PropSpec {
  name: string
  build: () => TerrainData
  at: Vec3
  rotation?: Vec3
  scale?: number
}

/** One of the game's structure pieces, loaded after the scene is up; optionally remixed. */
interface PieceSpec {
  id: string
  at: Vec3
  rotation?: Vec3
  scale?: number
  remix?: 'scramble' | 'ruin'
}

interface VfxSpec {
  effect: VfxType
  at: Vec3
  color: string
  density?: number
  scale?: number
}

interface MobSpec {
  /** Entity id, e.g. "zombie". */
  mob: string
  at: Vec3
  yaw: number
  /** Preferred texture (e.g. the angry wolf); otherwise the model's best match. */
  texture?: string
  /** Extra rotation per model part, e.g. zombie arms held out in front. */
  parts?: Record<string, Vec3>
  scale?: number
  /** Used when this version has no model for `mob` (e.g. the warden before 1.19). */
  fallback?: string
}

interface LightSpec {
  at: Vec3
  color?: string
  intensity?: number
  range?: number
  /** A spotlight aimed at this point; a point light when unset. */
  aim?: Vec3
}

/** A thumbnail-kit sticker: `at` is its centre in the frame (0…1 from the top left), `size` its height share. */
interface StickerSpec {
  shape: StickerShape
  color: string
  at: [number, number]
  size: number
  turn?: number
  weight?: number
  stretch?: number
  glow?: boolean
  flip?: boolean
}

interface TextSpec {
  text: string
  color: string
  /** Where its centre sits in the frame: -1…1 left→right and bottom→top. */
  screen: [number, number]
  /** How tall the whole text block is, as a share of the frame height. */
  height: number
  /** A title style from TEXT_STYLES (its colours override `color`). */
  style?: string
}

export interface Template {
  id: string
  name: string
  hint: string
  /** Ready-made ground, or null for scenes built only from props. */
  backdrop: BackdropId | null
  sky: SkyPreset
  /** Colour for the 'color' sky preset. */
  skyColor?: string
  /** Tweaks on top of the look preset (depth of field, bloom…). */
  effects?: Partial<EffectSettings>
  /** Only listed once the secret code has been entered. */
  secret?: boolean
  look: LookId
  settings?: Partial<SceneSettings>
  players: PlayerSpec[]
  texts: TextSpec[]
  /** Mobs, added once their models have been read from the game (in the background the first time). */
  mobs?: MobSpec[]
  /** Thick tree trunks in the foreground, for peeking-from-behind shots. */
  trunks?: Vec3[]
  /** Stone watchtowers (base position); someone on top stands TOWER_TOP blocks higher. */
  towers?: Vec3[]
  /** Lights; a bare position is a warm lantern glow. */
  lights?: (Vec3 | LightSpec)[]
  props?: PropSpec[]
  pieces?: PieceSpec[]
  vfx?: VfxSpec[]
  stickers?: StickerSpec[]
  /** Models built in Blender (tools/blender), placed where they were built (plus an optional offset). */
  models?: ModelSpec[]
  camera: CameraState
  fov: number
}

type SecretModel = keyof typeof SECRET_ANCHORS

interface ModelSpec {
  file: SecretModel
  name: string
  /** Moves the model from where it was built. */
  offset?: Vec3
  /** Or puts its anchor (bottom centre) at an exact spot instead. */
  at?: Vec3
  rotation?: Vec3
}

const YELLOW = '#ffe14d'
const RED = '#ff3b3b'
const DAY: Partial<SceneSettings> = { renderMode: 'cinematic', sunStrength: 1, ambientStrength: 1 }
/** Title text floats this far in front of the camera (it is drawn on top, so depth only sets its size). */
const TEXT_DEPTH = 2

/** Yaw (degrees) that turns something at `from` to face `to`. */
const toward = (from: Vec3, to: Vec3): number =>
  Math.round(THREE.MathUtils.radToDeg(Math.atan2(to[0] - from[0], to[2] - from[2])))

/** Zombies and skeletons hold their arms out in front, like in game. */
const ARMS_OUT: Record<string, Vec3> = { right_arm: [-90, 0, 0], left_arm: [-85, 0, 0] }

const HERO: Vec3 = [0, 0, 1.6]
const horde = (mob: string, at: Vec3, extra: Partial<MobSpec> = {}): MobSpec => ({
  mob,
  at,
  yaw: toward(at, HERO),
  ...(/zombie|husk|drowned|skeleton|stray/.test(mob) && { parts: ARMS_OUT }),
  ...extra
})

const TOWER_AT: Vec3 = [4.5, -1, -7]
const TOWER_HERO: Vec3 = [-0.8, 0, 1.6]
const LOOKOUT: Vec3 = [4.5, TOWER_TOP - 1, -7]

export const TEMPLATES: Template[] = [
  {
    id: 'reaction',
    name: 'Shocked find',
    hint: 'Deep in a torch-lit cave, staring at diamonds',
    backdrop: 'cave',
    sky: 'night',
    look: 'teal-orange',
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.35, fog: false },
    players: [{ name: 'Steve', pose: 'Shocked', at: [-0.6, 0, 0.8], yaw: 150 }],
    texts: [{ text: 'DIAMONDS?!', color: '#7df9ff', style: 'Diamond', screen: [0.42, 0.55], height: 0.24 }],
    lights: [
      { at: [-3.2, 2.2, -3.5], color: '#ffb35c', intensity: 45, range: 12 },
      { at: [3, 1.5, -1], color: '#ffb35c', intensity: 30, range: 10 },
      { at: [5, 0.5, -9], color: '#ff6a1f', intensity: 60, range: 14 },
      { at: [1.5, 2.5, 4.5], aim: [-0.6, 1.4, 0.8], color: '#bfe4ff', intensity: 70, range: 10 }
    ],
    camera: { position: [1.4, 1.1, 4.2], target: [-2.2, 1.6, -3] },
    fov: 55
  },
  {
    id: 'survival',
    name: '100 days stranded',
    hint: 'Victory on a desert island, shot low from the sea',
    backdrop: 'island',
    sky: 'golden',
    look: 'pop',
    settings: { ...DAY, sunAzimuth: 300, sunElevation: 14 },
    players: [{ name: 'Steve', pose: 'Victory', at: [-0.8, 0, 0.6], yaw: 25 }],
    texts: [{ text: 'I SURVIVED\n100 DAYS', color: YELLOW, style: 'Gold', screen: [0.42, 0.42], height: 0.38 }],
    camera: { position: [1.9, 0.45, 4.6], target: [-0.7, 1.9, 0] },
    fov: 55
  },
  {
    id: 'versus',
    name: 'Versus showdown',
    hint: 'Low angle over your shoulder at a rival on a tower',
    backdrop: 'meadow',
    sky: 'sunset',
    look: 'teal-orange',
    settings: { ...DAY, sunAzimuth: 20, sunElevation: 8 },
    players: [
      {
        name: 'Steve',
        pose: 'Blocking',
        at: TOWER_HERO,
        yaw: toward(TOWER_HERO, LOOKOUT),
        equipment: { mainHand: 'diamond_sword', offHand: 'shield' }
      },
      {
        name: 'Alex',
        pose: 'Bow aim',
        at: LOOKOUT,
        yaw: toward(LOOKOUT, TOWER_HERO),
        equipment: { mainHand: 'bow' }
      }
    ],
    towers: [TOWER_AT],
    texts: [{ text: 'VS', color: RED, style: 'Fire', screen: [-0.45, 0.45], height: 0.32 }],
    camera: { position: [-2.9, 0.5, 5.2], target: [3.6, 6.2, -6.5] },
    fov: 60
  },
  {
    id: 'nether',
    name: 'Nether leap',
    hint: 'Side shot of a leap across a lava ravine, piglins behind',
    backdrop: 'ravine',
    sky: 'nether',
    look: 'teal-orange',
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.45, fog: true },
    players: [{ name: 'Steve', pose: 'Leaping', at: [-0.4, 1.4, 0], yaw: 90 }],
    mobs: [
      { mob: 'zombified_piglin', at: [-6.5, 0, -0.6], yaw: 90, parts: ARMS_OUT },
      { mob: 'zombified_piglin', at: [-8.5, 0, 1.2], yaw: 80, parts: ARMS_OUT },
      { mob: 'ghast', at: [9, 9, -16], yaw: -30 }
    ],
    texts: [{ text: 'ESCAPE?!', color: RED, style: 'Fire', screen: [0, 0.6], height: 0.24 }],
    lights: [
      { at: [0, -3, 0], color: '#ff6a1f', intensity: 90, range: 18 },
      { at: [0, -3, -7], color: '#ff6a1f', intensity: 70, range: 16 },
      { at: [-2, 4, 5], aim: [-0.4, 2, 0], color: '#ffd2a1', intensity: 70, range: 12 }
    ],
    camera: { position: [-0.2, 1.4, 9.5], target: [-0.2, 0.6, 0] },
    fov: 55
  },
  {
    id: 'squad',
    name: 'Squad incoming',
    hint: 'You peek from behind a tree as an armed squad charges in',
    backdrop: 'forest',
    sky: 'night',
    look: 'teal-orange',
    settings: { renderMode: 'cinematic', sunStrength: 0.15, ambientStrength: 0.35, fog: true },
    players: [
      { name: 'Steve', pose: 'Blocking', at: [-1.35, 0, 2.4], yaw: 40, equipment: { mainHand: 'iron_sword' } },
      ...(
        [
          ['Kai', 'kai', false, [1.3, 0, -0.6], 'Sprinting', 'netherite_sword'],
          ['Noor', 'noor', true, [2.7, 0, -2.2], 'Sword swing', 'diamond_sword'],
          ['Efe', 'efe', true, [0.3, 0, -3.4], 'Sprinting', 'netherite_sword'],
          ['Makena', 'makena', true, [3.7, 0, -4.6], 'Lunge', 'diamond_sword'],
          ['Sunny', 'sunny', false, [1.7, 0, -6.2], 'Sprinting', 'netherite_sword']
        ] as const
      ).map(([name, skin, slim, at, pose, sword]) => ({
        name,
        skin,
        slim,
        at: [...at] as Vec3,
        // Charging at the hero.
        yaw: toward([...at] as Vec3, [-1.35, 0, 2.4]),
        pose,
        // Purple-dyed leather reads like the enchanted gear in squad thumbnails.
        equipment: { chest: 'leather', legs: 'leather', feet: 'leather', leatherColor: '#7d3fd8', mainHand: sword }
      }))
    ],
    texts: [],
    trunks: [[-2.75, -1, 3.2]],
    lights: [
      { at: [2.2, 7, 1.5], aim: [2, 0.5, -2.5], color: '#d9c4ff', intensity: 420, range: 30 },
      { at: [1.2, 3, 4.5], aim: [-1.3, 1.4, 2.4], color: '#ffd9a8', intensity: 90, range: 14 }
    ],
    camera: { position: [0.2, 1.5, 5.4], target: [0.8, 1.3, -1] },
    fov: 50
  },
  {
    id: 'horde',
    name: 'Mob horde',
    hint: 'Surrounded in a dark forest as the horde closes in',
    backdrop: 'forest',
    sky: 'night',
    look: 'night',
    settings: { renderMode: 'cinematic', ...NIGHT_LIGHTING, fog: true },
    players: [{ name: 'Steve', pose: 'Blocking', at: HERO, yaw: 0, equipment: { mainHand: 'diamond_sword' } }],
    mobs: [
      horde('wolf', [-2.4, 0, 1.6], { texture: 'entity/wolf/wolf_angry' }),
      horde('wolf', [2.5, 0, 1.2], { texture: 'entity/wolf/wolf_angry' }),
      horde('zombie', [-1.6, 0, -0.8]),
      horde('zombie', [1.4, 0, -1.4]),
      horde('husk', [-3.4, 0, -2.4]),
      horde('zombie', [3.2, 0, -3]),
      horde('skeleton', [0.2, 0, -3.2]),
      horde('skeleton', [-1.8, 0, -4.6]),
      horde('spider', [2.4, 0, -5.2]),
      horde('creeper', [-0.6, 0, -6]),
      horde('zombie', [4.6, 0, -6.4]),
      horde('creeper', [-4.4, 0, -6.8])
    ],
    texts: [],
    lights: [
      { at: [-2.4, 1.2, 2.4], color: '#3fe0d0', intensity: 25, range: 7 },
      { at: [2.5, 1.2, 2], color: '#3fe0d0', intensity: 25, range: 7 },
      { at: [0, 4, -2.5], aim: [0, 1.6, 1.6], color: '#8fe8ff', intensity: 220, range: 16 },
      { at: [0, 2.5, 5], aim: [0, 1.4, 1.6], color: '#cfe6ff', intensity: 60, range: 10 }
    ],
    camera: { position: [0, 1.3, 6], target: [0, 1.3, -1] },
    fov: 55
  },
  // ---- Unlocked with the secret code: three thumbnail ideas for Loveguard's ThumbCraft launch video.
  {
    id: 'lg-machine',
    secret: true,
    name: 'It makes thumbnails?!',
    hint: 'Cobblestone rides into a giant machine and comes out as a glowing epic thumbnail; Loveguard is stunned',
    backdrop: null,
    sky: 'color',
    skyColor: '#0b0f1c',
    look: 'teal-orange',
    effects: { bloom: true, bloomIntensity: 1.1, bloomThreshold: 0.55, vignette: true, vignetteDarkness: 0.55 },
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.75, fog: false, sunAzimuth: 140 },
    players: [{ name: 'Loveguard', username: 'Loveguard', pose: 'Shocked', at: [-3.4, 0, 6.6], yaw: 24 }],
    models: [{ file: 'machine', name: 'Thumbnail machine (Blender)' }],
    vfx: [
      { effect: 'shine', at: [10.2, 2.4, -2.2], color: '#fff2c4', density: 0.35, scale: 1 },
      { effect: 'smoke', at: [-2, 10.4, -6.2], color: '#8d939b', density: 0.4, scale: 0.45 }
    ],
    lights: [
      { at: [3, 9, 9], aim: [-2.5, 1.5, 0], color: '#ffe3b8', intensity: 380, range: 34 },
      { at: [-7, 6, -11], color: '#36c8ff', intensity: 140, range: 26 },
      { at: [8, 2.5, -0.8], color: '#ff7ad1', intensity: 90, range: 12 }
    ],
    texts: [{ text: 'IT MAKES\nTHUMBNAILS?!', color: YELLOW, screen: [-0.45, 0.6], height: 0.32, style: 'Gold' }],
    stickers: [{ shape: 'arrow', color: '#ff2a2a', at: [0.66, 0.3], size: 0.17, turn: 38, stretch: 1.3 }],
    camera: { position: [0.5, 2.4, 13.5], target: [0.5, 3.4, -3] },
    fov: 50
  },
  {
    id: 'lg-studio',
    secret: true,
    name: 'How I fake my thumbnails',
    hint: 'Behind the scenes: a creeper "explodes" on a green screen set, filmed by a cinema camera under softboxes',
    backdrop: null,
    sky: 'color',
    skyColor: '#141418',
    look: 'cinema-cool',
    effects: { bloom: true, bloomIntensity: 0.9, bloomThreshold: 0.6, vignette: true, vignetteDarkness: 0.5 },
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.8, fog: false, sunAzimuth: 200 },
    players: [{ name: 'Loveguard', username: 'Loveguard', pose: 'Shocked', at: [-0.2, 0.03, -3.2], yaw: 22 }],
    mobs: [{ mob: 'creeper', at: [2.7, 0.03, -5.0], yaw: -62 }],
    models: [{ file: 'studio', name: 'Film set (Blender)' }],
    vfx: [{ effect: 'explosion', at: [3.6, 0, -8.8], color: '#ffa53a', density: 0.5, scale: 0.5 }],
    lights: [
      { at: [-7.2, 5.1, -3.2], aim: [0.2, 1.2, -4.6], color: '#fff6e8', intensity: 280, range: 22 },
      { at: [7.6, 5.1, -2.6], aim: [1.6, 1.2, -4.9], color: '#fff6e8', intensity: 220, range: 22 },
      { at: [3.2, 2.2, -7.2], color: '#ff9a3c', intensity: 70, range: 7 },
      { at: [-0.5, 2.5, 1], color: '#ffffff', intensity: 40, range: 8 }
    ],
    texts: [
      { text: 'HOW I FAKE MY\nTHUMBNAILS', color: '#ffffff', screen: [0.3, 0.66], height: 0.3, style: 'Bold white' }
    ],
    stickers: [{ shape: 'circle', color: '#ff2a2a', at: [0.6, 0.6], size: 0.52, stretch: 1.85, weight: 1.2 }],
    camera: { position: [-0.6, 2.6, 7.5], target: [0.8, 1.6, -6] },
    fov: 48
  },
  {
    id: 'lg-gallery',
    secret: true,
    name: '$1,000 thumbnail vs $0',
    hint: "A pricey designer's doodle next to an epic glowing picture made for free; Loveguard can't believe it",
    backdrop: null,
    sky: 'color',
    skyColor: '#1a0a10',
    look: 'pop',
    effects: { bloom: true, bloomIntensity: 0.8, bloomThreshold: 0.6, vignette: true, vignetteDarkness: 0.6 },
    settings: { renderMode: 'cinematic', sunStrength: 0.3, ambientStrength: 0.6, fog: false, sunAzimuth: 180 },
    players: [{ name: 'Loveguard', username: 'Loveguard', pose: 'Pointing', at: [0.2, 0, 3.6], yaw: 62 }],
    models: [{ file: 'gallery', name: 'Gallery and easels (Blender)' }],
    vfx: [{ effect: 'shine', at: [5.6, 2.2, -1.9], color: '#fff4cf', density: 0.3, scale: 0.8 }],
    lights: [
      { at: [-3.9, 8, 2], aim: [-3.9, 2.6, -2.4], color: '#ffe8c8', intensity: 200, range: 18 },
      { at: [3.9, 8, 2], aim: [3.9, 2.6, -2.4], color: '#ffe8c8', intensity: 260, range: 18 },
      { at: [-1.5, 3.5, 6.5], color: '#ffd9b0', intensity: 45, range: 9 }
    ],
    texts: [
      { text: '$1,000', color: '#ffffff', screen: [-0.5, 0.74], height: 0.17, style: 'Bold white' },
      { text: '$0', color: '#43e97b', screen: [0.52, 0.74], height: 0.22, style: 'Toxic' }
    ],
    stickers: [
      { shape: 'cross', color: '#ff2a2a', at: [0.25, 0.47], size: 0.2, weight: 0.8 },
      { shape: 'circle', color: '#43e97b', at: [0.75, 0.5], size: 0.42, stretch: 1.6, glow: true }
    ],
    camera: { position: [0, 2.7, 10.5], target: [0, 2.4, -2] },
    fov: 50
  }
]

/** Puts a title at its spot in the template's frame (a text object is 1.6 units tall per line). */
const textPlacement = (t: Template, x: TextSpec): { position: Vec3; rotation: Vec3; scale: number } =>
  frameTransform(t.camera.position, t.camera.target, t.fov, 16 / 9, {
    screen: x.screen,
    height: x.height,
    unitHeight: 1.6 * x.text.split('\n').length,
    depth: TEXT_DEPTH
  })

/** Replaces the current scene with a template (the old one stays in Recent projects via autosave). */
export async function applyTemplate(t: Template): Promise<void> {
  await flushAutosave()
  newProject()
  const s = useStore.getState()
  s.setProject({ name: t.name })
  s.setSky({ ...DEFAULT_SKY, preset: t.sky, ...(t.skyColor && { color: t.skyColor }) })
  const { sunInView: _sun, ...look } = lookSettings(t.look)
  s.setEffects({ ...NO_EFFECTS, ...look, ...t.effects })
  s.setSettings({ ...t.settings, fov: t.fov, shot: { ...t.camera, fov: t.fov } })

  // The backdrop's centre ground sits at y=0, where the players stand.
  if (t.backdrop) applyReadyMadeBiome(t.backdrop)
  const textures = new Set(s.assets?.textures ?? [])
  for (const p of t.players) {
    const slim = p.slim ?? p.name === 'Alex'
    const skin = `entity/player/${slim ? 'slim' : 'wide'}/${p.skin ?? (slim ? 'alex' : 'steve')}`
    s.add({
      id: newId('obj'),
      kind: 'player',
      name: p.name,
      skinUrl: textures.has(skin) ? assetUrl(skin) : defaultSkinUrl(slim),
      slim,
      pose: structuredClone(POSES[p.pose]),
      ...(p.equipment && { equipment: { ...NO_EQUIPMENT, ...p.equipment } }),
      visible: true,
      position: p.at,
      rotation: [0, p.yaw, 0],
      scale: p.scale ?? 1
    })
  }
  for (const pr of t.props ?? []) {
    addTerrain(pr.build(), pr.name, pr.at)
    const added = useStore.getState().objects.at(-1)
    if (added && (pr.rotation || pr.scale))
      s.update(added.id, { rotation: pr.rotation ?? [0, 0, 0], scale: pr.scale ?? 1 })
  }
  for (const v of t.vfx ?? [])
    s.add({
      id: newId('obj'),
      kind: 'vfx',
      name: VFX_PRESETS.find((p) => p.id === v.effect)?.label ?? v.effect,
      effect: v.effect,
      color: v.color,
      density: v.density ?? 0.6,
      opacity: 1,
      glow: true,
      seed: 7,
      visible: true,
      position: v.at,
      rotation: [0, 0, 0],
      scale: v.scale ?? 1
    })
  for (const at of t.trunks ?? []) addTerrain(buildTrunk(), 'Tree trunk', at)
  for (const at of t.towers ?? []) addTerrain(buildTower(), 'Watchtower', at)
  for (const x of t.texts)
    s.add({
      ...textPlacement(t, x),
      id: newId('obj'),
      kind: 'text',
      name: `Text: ${x.text.replace(/\n/g, ' ').slice(0, 16)}`,
      text: x.text,
      color: x.color,
      outlineColor: '#000000',
      outlineWidth: 14,
      font: FONTS[0].family,
      shadow: true,
      onTop: true,
      visible: true,
      ...TEXT_STYLES.find((st) => st.name === x.style)?.style
    })
  for (const st of t.stickers ?? [])
    s.add({
      id: newId('obj'),
      kind: 'sticker',
      name: STICKERS.find((x) => x.id === st.shape)?.label ?? 'Sticker',
      shape: st.shape,
      color: st.color,
      outline: true,
      glow: !!st.glow,
      flip: st.flip,
      weight: st.weight,
      stretch: st.stretch,
      visible: true,
      position: [st.at[0], st.at[1], 0],
      rotation: [0, 0, st.turn ?? 0],
      scale: st.size
    })
  for (const spec of t.lights ?? []) {
    const l: LightSpec = Array.isArray(spec) ? { at: spec } : spec
    s.add({
      id: newId('obj'),
      kind: 'light',
      name: l.aim ? 'Spotlight' : 'Lantern glow',
      lightType: l.aim ? 'spot' : 'point',
      color: l.color ?? '#ffb35c',
      intensity: l.intensity ?? 30,
      range: l.range ?? 12,
      angle: 40,
      softness: 0.4,
      shadows: !!l.aim,
      gobo: null,
      visible: true,
      position: l.at,
      rotation: l.aim ? aimAt(l.at, l.aim) : [0, 0, 0],
      scale: 1
    })
  }
  // A fresh start: nothing to undo back into, nothing unsaved yet.
  useStore.setState({ selectedId: null, selectedIds: [], past: [], future: [] })
  cameraBridge.set?.(t.camera)
  markClean()
  if (t.mobs?.length) void addTemplateMobs(t.mobs)
  if (t.pieces?.length) void addTemplatePieces(t.pieces)
  if (t.models?.length) void addTemplateModels(t.models)
  for (const p of t.players) if (p.username) void wearSkin(p.name, p.username)
}

/** True while the user hasn't edited the freshly applied template (its late loads keep it that way). */
const untouched = (): boolean => useStore.getState().past.length === 0

/**
 * After a template's late load (skins, pieces, models, mobs): if the user hadn't touched the scene yet, it is
 * still a fresh start with nothing to undo or save. Once they have, their history and unsaved state stay.
 */
function settle(pristine: boolean, deselect = true): void {
  if (!pristine) return
  useStore.setState({ ...(deselect ? { selectedId: null, selectedIds: [] } : {}), past: [], future: [] })
  markClean()
}

/** Puts an account's skin on the template player of that name, if Mojang knows the account. */
async function wearSkin(name: string, username: string): Promise<void> {
  const projectId = useStore.getState().project.id
  try {
    const skin = await window.blockframe.fetchSkin(username)
    if (useStore.getState().project.id !== projectId) return
    const pristine = untouched()
    const o = useStore.getState().objects.find((x) => x.kind === 'player' && x.name === name)
    if (o) useStore.getState().update(o.id, { skinUrl: skin.skinDataUrl, slim: skin.model === 'slim' })
    settle(pristine, false)
  } catch {
    /* offline, or no such account: the default skin stays */
  }
}

/** Loads a template's structure pieces from the game (remixing them if asked) once the scene is up. */
async function addTemplatePieces(pieces: PieceSpec[]): Promise<void> {
  const projectId = useStore.getState().project.id
  let pristine = true
  for (const [i, p] of pieces.entries()) {
    let t: TerrainData
    try {
      t = await window.blockframe.loadStructure(p.id)
    } catch {
      continue // this version doesn't have the piece
    }
    if (useStore.getState().project.id !== projectId) return
    pristine &&= untouched()
    if (p.remix === 'scramble') t = scrambleBlocks(t, i + 1)
    if (p.remix === 'ruin') t = ruinBlocks(t, i + 1)
    addTerrain(t, p.id.split('/').pop()!.replace(/_/g, ' '), p.at)
    const added = useStore.getState().objects.at(-1)
    if (added) useStore.getState().update(added.id, { rotation: p.rotation ?? [0, 0, 0], scale: p.scale ?? 1 })
  }
  settle(pristine)
}

/** Loads a template's Blender models (shipped next to the app) and places them where they were built. */
async function addTemplateModels(models: ModelSpec[]): Promise<void> {
  const projectId = useStore.getState().project.id
  let pristine = true
  for (const m of models) {
    let bytes: Uint8Array
    try {
      const res = await fetch(`tcres://secret/${m.file}.glb`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      bytes = new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      useStore.getState().setStatus(`Couldn't load the ${m.name} model: ${errorText(e)}`)
      continue
    }
    if (useStore.getState().project.id !== projectId) return
    pristine &&= untouched()
    const media = registerMedia(`${m.file}.glb`, 'model/gltf-binary', bytes)
    const anchor = SECRET_ANCHORS[m.file] as Vec3
    const o = m.offset ?? [0, 0, 0]
    useStore.getState().add({
      id: newId('obj'),
      kind: 'model',
      name: m.name,
      mediaId: media.id,
      extraMediaIds: [],
      visible: true,
      position: m.at ?? [anchor[0] + o[0], anchor[1] + o[1], anchor[2] + o[2]],
      rotation: m.rotation ?? [0, 0, 0],
      scale: 1
    })
  }
  settle(pristine)
}

/** Adds a template's mobs once the game's mob models are ready (they are read from the jar on first use). */
async function addTemplateMobs(mobs: MobSpec[]): Promise<void> {
  const projectId = useStore.getState().project.id
  let models: MobModels
  try {
    models = await mobModels()
  } catch {
    useStore.getState().setStatus("Couldn't read the mob models, so this scene has no mobs; see the Mobs tab.")
    return
  }
  const s = useStore.getState()
  if (s.project.id !== projectId) return // the user moved on to another scene meanwhile
  const pristine = untouched()
  for (const m of mobs) {
    const key = [m.mob, m.fallback].map((id) => `minecraft:${id}#main`).find((k) => models.layers[k])
    if (!key) continue
    const layer = models.layers[key]
    const candidates = textureCandidates(key, layer, models.textureSizes)
    const texture = m.texture && candidates.includes(m.texture) ? m.texture : candidates[0]
    if (!texture) continue
    s.add({
      id: newId('obj'),
      kind: 'mob',
      name: m.mob.replace(/^./, (c) => c.toUpperCase()),
      layer: key,
      texture,
      partRotations: m.parts ?? {},
      visible: true,
      position: m.at,
      rotation: [0, m.yaw, 0],
      scale: m.scale ?? 1
    })
  }
  // Mobs arriving later aren't an edit to undo, and none of them should end up selected.
  settle(pristine)
}

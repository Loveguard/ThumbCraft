// Ready-made thumbnail layouts: an instant backdrop, posed players, title text, sky, lighting and a look,
// framed by a saved camera shot. Everything is a normal scene object afterwards, so users just edit the text
// and swap in their own skin.
import { buildTower, buildTrunk, type BackdropId } from '@shared/minecraft/backdrops'
import { buildGlassPane, ruinBlocks, scrambleBlocks } from '@shared/minecraft/props'
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
import SECRET_ANCHORS from '../../../resources/secret/anchors.json'

/** Where Loveguard stands on the valley ledge in the vision scene (on top of the ledge's blocks). */
const LG_VISION: Vec3 = [1.2, 2, 1.6]

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

/**
 * Glasses on a player's face: the frames sit just in front of the eyes, turned with the player.
 * (Built facing +z with their lenses 0.07 above the model's bottom and 0.15 in front of its centre.)
 */
function glassesOn(at: Vec3, yaw: number, scale = 1): { at: Vec3; rotation: Vec3 } {
  const r = THREE.MathUtils.degToRad(yaw)
  const fwd = [Math.sin(r), 0, Math.cos(r)]
  const eye = 1.71 * scale
  const front = 0.27 * scale - 0.151
  return {
    at: [at[0] + fwd[0] * front, at[1] + eye - 0.07, at[2] + fwd[2] * front],
    rotation: [0, yaw, 0]
  }
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

/** Shallow depth of field focused on a point of the frame (x right, y down). */
const focusOn = (x: number, y: number, blur = 3): Partial<EffectSettings> => ({
  depthOfField: true,
  dofBlur: blur,
  dofRange: 0.35,
  focusPoints: [{ x, y }]
})
/** Diamond armour, helmet left off so the face shows. */
const DIAMOND_KIT: Partial<Equipment> = { chest: 'diamond', legs: 'diamond', feet: 'diamond' }

export const TEMPLATES: Template[] = [
  {
    id: 'reaction',
    name: 'Shocked find',
    hint: 'Over the shoulder at a glowing diamond vein deep in the cave',
    backdrop: 'cave',
    sky: 'night',
    look: 'teal-orange',
    effects: { bloom: true, bloomIntensity: 1.3, bloomThreshold: 0.5, vignette: true, vignetteDarkness: 0.6 },
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.25, fog: true },
    players: [{ name: 'Steve', pose: 'Pointing', at: [-0.95, 0, 2.3], yaw: 165 }],
    vfx: [
      { effect: 'shine', at: [0.6, 0, -4.5], color: '#8ff0ff', density: 0.8, scale: 2.2 },
      { effect: 'embers', at: [0.6, -0.5, -4.5], color: '#7df9ff', density: 0.4, scale: 0.8 }
    ],
    texts: [{ text: 'I FOUND IT...', color: '#ffffff', style: 'Bold white', screen: [0.1, 0.66], height: 0.16 }],
    lights: [
      { at: [0.6, 1.2, -4], color: '#5fe8ff', intensity: 160, range: 14 },
      { at: [-2, 2, 4], color: '#ffb35c', intensity: 25, range: 7 }
    ],
    camera: { position: [0.1, 1.65, 4.3], target: [0.2, 1.0, -4] },
    fov: 46
  },
  {
    id: 'survival',
    name: '100 days stranded',
    hint: 'Worm’s-eye victory into the setting sun, title across the top',
    backdrop: 'island',
    sky: 'clear',
    look: 'golden',
    effects: {
      bloom: true,
      bloomIntensity: 0.6,
      bloomThreshold: 0.75,
      godRays: true,
      godRaysIntensity: 0.35,
      vignette: true
    },
    settings: { ...DAY, sunAzimuth: 180, sunElevation: 30 },
    players: [
      {
        name: 'Steve',
        pose: 'Victory',
        at: [0, 0, 0.8],
        yaw: 0,
        equipment: { ...DIAMOND_KIT, mainHand: 'diamond_sword' }
      }
    ],
    texts: [{ text: '100 DAYS', color: YELLOW, style: 'Gold', screen: [0, 0.68], height: 0.26 }],
    camera: { position: [0.2, 0.25, 3.6], target: [0, 1.55, 0.8] },
    fov: 50
  },
  {
    id: 'versus',
    name: 'Versus showdown',
    hint: 'Face-off: two fighters nose to nose, VS between them',
    backdrop: 'meadow',
    sky: 'sunset',
    look: 'teal-orange',
    effects: { bloom: false, vignette: true, ...focusOn(0.5, 0.4, 2.5) },
    settings: { ...DAY, sunAzimuth: 0, sunElevation: 10 },
    players: [
      {
        name: 'Steve',
        pose: 'Blocking',
        at: [-0.8, 0, 0.6],
        yaw: 90,
        equipment: { chest: 'diamond', mainHand: 'diamond_sword', offHand: 'shield' }
      },
      {
        name: 'Alex',
        pose: 'Sword swing',
        at: [0.8, 0, 0.6],
        yaw: -90,
        equipment: { chest: 'netherite', legs: 'netherite', mainHand: 'netherite_sword' }
      }
    ],
    texts: [{ text: 'VS', color: RED, style: 'Fire', screen: [0, 0.48], height: 0.32 }],
    lights: [
      { at: [-2.5, 2.5, 2.5], color: '#4fb8ff', intensity: 60, range: 8 },
      { at: [2.5, 2.5, 2.5], color: '#ff5a3c', intensity: 60, range: 8 }
    ],
    camera: { position: [0, 1.25, 3.6], target: [0, 1.2, 0] },
    fov: 40
  },
  {
    id: 'nether',
    name: 'Nether leap',
    hint: 'Low angle as you leap over the lava, ghast overhead',
    backdrop: 'ravine',
    sky: 'nether',
    look: 'teal-orange',
    effects: { bloom: true, bloomIntensity: 1.1, bloomThreshold: 0.55, vignette: true },
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.45, fog: true },
    players: [{ name: 'Steve', pose: 'Leaping', at: [0, 1.4, 1.2], yaw: 40 }],
    mobs: [{ mob: 'ghast', at: [-3, 7, -8], yaw: 20 }],
    vfx: [{ effect: 'embers', at: [0, -2, 0], color: '#ff9c3a', density: 0.7, scale: 1.4 }],
    texts: [{ text: 'ESCAPE?!', color: RED, style: 'Fire', screen: [-0.42, 0.6], height: 0.22 }],
    lights: [
      { at: [0, -2.5, 1.2], color: '#ff6a1f', intensity: 120, range: 14 },
      { at: [2, 3, 5], aim: [0, 2, 1.2], color: '#ffd2a1', intensity: 60, range: 12 }
    ],
    camera: { position: [2.6, 3.4, 5.6], target: [-0.2, 0.6, 0.6] },
    fov: 46
  },
  {
    id: 'squad',
    name: 'Squad incoming',
    hint: 'Close on your worried face as the squad charges in behind',
    backdrop: 'forest',
    sky: 'night',
    look: 'teal-orange',
    effects: { bloom: true, bloomIntensity: 0.9, bloomThreshold: 0.6, vignette: true, ...focusOn(0.28, 0.42, 3.5) },
    settings: { renderMode: 'cinematic', sunStrength: 0.15, ambientStrength: 0.35, fog: true },
    players: [
      { name: 'Steve', pose: 'Blocking', at: [-0.95, 0, 2.6], yaw: 30, equipment: { mainHand: 'iron_sword' } },
      ...(
        [
          ['Kai', 'kai', false, [1.0, 0, -1.0], 'Sprinting', 'netherite_sword'],
          ['Noor', 'noor', true, [2.4, 0, -2.6], 'Sword swing', 'diamond_sword'],
          ['Efe', 'efe', true, [0.1, 0, -3.6], 'Sprinting', 'netherite_sword']
        ] as const
      ).map(([name, skin, slim, at, pose, sword]) => ({
        name,
        skin,
        slim,
        at: [...at] as Vec3,
        yaw: toward([...at] as Vec3, [-0.95, 0, 2.6]),
        pose,
        equipment: { chest: 'leather', legs: 'leather', feet: 'leather', leatherColor: '#7d3fd8', mainHand: sword }
      }))
    ],
    texts: [{ text: 'HUNTED', color: '#ff3b3b', style: 'Horror', screen: [0.42, 0.58], height: 0.27 }],
    lights: [
      { at: [2.2, 7, 1.5], aim: [1.5, 0.5, -2.5], color: '#d9c4ff', intensity: 380, range: 30 },
      { at: [0.8, 2.2, 5], aim: [-0.95, 1.5, 2.6], color: '#ffd9a8', intensity: 70, range: 9 }
    ],
    camera: { position: [0.2, 1.55, 5.6], target: [-0.35, 1.45, 1.4] },
    fov: 36
  },
  {
    id: 'horde',
    name: 'Mob horde',
    hint: 'From inside the horde, a zombie looming in front of you',
    backdrop: 'forest',
    sky: 'night',
    look: 'teal-orange',
    effects: { bloom: true, bloomIntensity: 0.9, bloomThreshold: 0.6, vignette: true, ...focusOn(0.62, 0.48, 3.5) },
    settings: { renderMode: 'cinematic', sunStrength: 0.25, ambientStrength: 0.55, fog: true },
    players: [{ name: 'Steve', pose: 'Blocking', at: [0.6, 0, 0.4], yaw: 0, equipment: { mainHand: 'diamond_sword' } }],
    mobs: [
      { mob: 'zombie', at: [-0.75, 0, 4.0], yaw: 165, parts: ARMS_OUT },
      { mob: 'zombie', at: [2.3, 0, 2.0], yaw: -120, parts: ARMS_OUT },
      { mob: 'skeleton', at: [-1.6, 0, 1.0], yaw: 120, parts: ARMS_OUT },
      { mob: 'creeper', at: [2.0, 0, -1.4], yaw: -100 }
    ],
    texts: [{ text: '1 VS 100', color: '#ffffff', style: 'Bold white', screen: [0.45, 0.62], height: 0.2 }],
    lights: [
      { at: [0.6, 4, -1.5], aim: [0.6, 1.4, 0.4], color: '#8fe8ff', intensity: 160, range: 12 },
      { at: [1.6, 2, 3], aim: [0.6, 1.4, 0.4], color: '#cfe6ff', intensity: 90, range: 8 },
      { at: [-0.2, 3, 2.5], color: '#7fd0ff', intensity: 40, range: 4 }
    ],
    camera: { position: [-0.35, 1.7, 5.2], target: [0.6, 1.3, 0.4] },
    fov: 38
  },
  // ---- Unlocked with the secret code: recreations of Loveguard's latest thumbnails.
  {
    id: 'lg-ai-vision',
    secret: true,
    name: 'Seeing Minecraft through AI',
    hint: 'Loveguard, in glasses, gazes across a vivid valley through a hazy pane',
    backdrop: null,
    sky: 'clear',
    look: 'pop',
    effects: { bloom: true, bloomIntensity: 0.6, bloomThreshold: 0.75 },
    settings: { ...DAY, sunAzimuth: 215, sunElevation: 30, fog: false },
    players: [{ name: 'Loveguard', username: 'Loveguard', pose: 'Standing', at: LG_VISION, yaw: -78 }],
    props: [
      // The hazy "AI view": a tall pane cutting diagonally across the right of the frame.
      { name: 'Glass pane', build: () => buildGlassPane(16, 18), at: [3.4, -2, -4], rotation: [0, 62, 0] }
    ],
    models: [
      { file: 'vision', name: 'Valley (Blender)' },
      { file: 'glasses', name: 'Glasses', ...glassesOn(LG_VISION, -78) }
    ],
    texts: [],
    camera: { position: [-1.4, 3.7, 6.4], target: [-7.5, 0.5, -30] },
    fov: 62
  },
  {
    id: 'lg-build-off',
    secret: true,
    name: 'Who builds best?',
    hint: 'A giant Loveguard judges four tiny builds on a table',
    backdrop: null,
    sky: 'night',
    look: 'teal-orange',
    effects: { bloom: true, bloomIntensity: 0.9, bloomThreshold: 0.6 },
    settings: {
      renderMode: 'cinematic',
      sunStrength: 0.7,
      ambientStrength: 0.85,
      fog: false,
      sunAzimuth: 160,
      sunElevation: 35
    },
    players: [{ name: 'Loveguard', username: 'Loveguard', pose: 'Pointing', at: [0.8, -3.2, -5.2], yaw: 12, scale: 7 }],
    models: [{ file: 'builds', name: 'Table and builds (Blender)' }],
    texts: [],
    lights: [
      { at: [-6, 7, 5], aim: [-2, 3, 0], color: '#ffd9a8', intensity: 260, range: 30 },
      { at: [7, 6, 4], color: '#b48cff', intensity: 60, range: 20 }
    ],
    camera: { position: [0, 5.6, 11.5], target: [0, 6.2, -2] },
    fov: 56
  },
  {
    id: 'lg-boss',
    secret: true,
    name: 'Bosses coded by AI',
    hint: 'From behind Loveguard, a giant spiked boss looms against blinding light',
    backdrop: null,
    sky: 'color',
    skyColor: '#f2f2f2',
    look: 'cinema-cool',
    effects: { bloom: true, bloomIntensity: 1.3, bloomThreshold: 0.6, vignette: true, vignetteDarkness: 0.6 },
    settings: { renderMode: 'cinematic', sunStrength: 0, ambientStrength: 0.18, fog: true },
    players: [{ name: 'Loveguard', username: 'Loveguard', pose: 'Waving', at: [0.3, 0, 2.2], yaw: 180 }],
    models: [{ file: 'boss', name: 'Boss and hall (Blender)', offset: [0, 0, -2.5] }],
    texts: [],
    lights: [
      { at: [0, 14, -30], aim: [0, 4, 4], color: '#ffffff', intensity: 1600, range: 60 },
      { at: [0, 4, -14], color: '#ffffff', intensity: 260, range: 24 }
    ],
    camera: { position: [0.6, 0.5, 5.6], target: [0, 6.5, -6] },
    fov: 74
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

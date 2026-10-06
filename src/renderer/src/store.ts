import { create } from 'zustand'
import type { PartName, Pose } from '@shared/minecraft/playerModel'
import { POSES } from '@shared/minecraft/playerModel'
import type { AssetBundle, TerrainData } from '@shared/types'
import type { ExportFormat } from './exportImage'
import type { VfxType } from './vfx'
import type { RenderMode } from './renderModes'
import type { PixelTextStyle } from './minecraft/builders'

export type Vec3 = [number, number, number]

interface Base {
  id: string
  name: string
  visible: boolean
  position: Vec3
  /** Degrees */
  rotation: Vec3
  scale: number
  /** Drawn over everything else in the scene, whatever is in front of it. */
  onTop?: boolean
  /** Unlit: its own colours, evenly bright, untouched by the scene's lights and shadows. */
  flat?: boolean
  /** Objects sharing a group id are selected and moved together. */
  groupId?: string
}

export interface TerrainObject extends Base {
  kind: 'terrain'
  terrainId: string
  /** The scene's landscape (a ready-made or generated biome, an imported world), as opposed to a build. */
  ground?: boolean
}
/** What a player wears and holds. Armor values are material ids (e.g. "diamond"); items are item ids. */
export interface Equipment {
  head: string | null
  chest: string | null
  legs: string | null
  feet: string | null
  /** Dye colour for leather armor. */
  leatherColor: string
  mainHand: string | null
  offHand: string | null
}

export const NO_EQUIPMENT: Equipment = {
  head: null,
  chest: null,
  legs: null,
  feet: null,
  leatherColor: '#a06540', // vanilla's undyed leather
  mainHand: null,
  offHand: null
}

export interface PlayerObject extends Base {
  kind: 'player'
  skinUrl: string
  slim: boolean
  pose: Pose
  /** Missing in projects saved before armor existed. */
  equipment?: Equipment
  /** Show the player's name above their head, like in game. */
  nameTag?: boolean
}
export interface ImageObject extends Base {
  kind: 'image' | 'video'
  url: string
  /** Set for user-imported files: their bytes live in mediaStore and are saved inside projects. */
  mediaId?: string
  aspect: number
  opacity: number
  onTop: boolean
  /** Nearest-neighbour scaling for pixel art (particles, game textures). */
  pixelated?: boolean
  /** Multiplies the image colour; Minecraft tints several grayscale particles this way. */
  tint?: string
}
export interface TextObject extends Base {
  kind: 'text'
  text: string
  color: string
  outlineColor: string
  outlineWidth: number
  font: string
  /** A font file the user imported (saved in the project); overrides `font`. */
  fontMediaId?: string
  shadow: boolean
  onTop: boolean
  /** Second fill colour: the fill fades from `color` (top) to this (bottom). */
  gradient?: string | null
  /** A second, outer outline around the first. */
  outline2Color?: string
  outline2Width?: number
  /** Soft coloured glow around the letters. */
  glow?: string | null
}
export interface PixelTextObject extends Base {
  kind: 'pixelText'
  text: string
  /** Letter colour; for the stone looks, the tint over the stone texture. */
  color: string
  depth: number
  /** Plain: the vanilla text shadow. Stone looks: the black outline. */
  shadow: boolean
  /** Plain font pixels, or carved logo-style letters in grey stone or hardcore red. */
  style?: PixelTextStyle
}

export interface MobObject extends Base {
  kind: 'mob'
  /** Model layer location, e.g. "minecraft:zombie#main". */
  layer: string
  /** Entity texture path from the jar, e.g. "entity/zombie/zombie". */
  texture: string
  /** Extra rotation (degrees) per part path, on top of the model's own pose. */
  partRotations: Record<string, Vec3>
}

export type LightType = 'point' | 'spot'

/** A placeable light. Spotlights shine along the object's local +Z (rotate it to aim). */
export interface LightObject extends Base {
  kind: 'light'
  lightType: LightType
  color: string
  /** Candela-like brightness (three.js physical units). */
  intensity: number
  /** Reach in blocks; light fades to nothing here. 0 = unlimited. */
  range: number
  /** Spotlight cone width in degrees. */
  angle: number
  /** Soft edge of the spotlight cone, 0–1. */
  softness: number
  shadows: boolean
  /** Spotlight pattern ("gobo"): a built-in id, or 'custom' with goboMediaId. */
  gobo: string | null
  goboMediaId?: string
}

/** An imported 3D model (.glb/.gltf/.obj). Its files live in the media store and are saved in projects. */
export interface ModelObject extends Base {
  kind: 'model'
  mediaId: string
  /** Files the model refers to: .bin buffers, textures, an .mtl for OBJ. */
  extraMediaIds: string[]
}

/** A flat mirror facing +Z; it reflects the scene (planar reflection). */
export interface MirrorObject extends Base {
  kind: 'mirror'
  width: number
  height: number
  /** Tints the reflection; white is a perfect mirror. */
  tint: string
  frame: boolean
}

/** A vanilla lightning bolt striking at the object's position (128 blocks tall at scale 1). */
export interface LightningObject extends Base {
  kind: 'lightning'
  /** Shapes the bolt exactly as the game does for the same seed. */
  seed: number
  color: string
  /** 1 = vanilla's glow; higher for a brighter, bloomier bolt. */
  brightness: number
  /** A bright flash lighting the ground around the strike. */
  flash: boolean
}

/** Smoke, fog, fire and other effects placed in the scene (see vfx.ts). */
export interface VfxObject extends Base {
  kind: 'vfx'
  effect: VfxType
  color: string
  /** 0…1: how many puffs (thin wisp to thick cloud). */
  density: number
  /** 0…1 overall opacity. */
  opacity: number
  /** Lights up its surroundings in Cinematic mode. */
  glow: boolean
  seed: number
}

export type WeatherType = 'none' | 'rain' | 'snow'

export type SceneObject =
  | TerrainObject
  | PlayerObject
  | ImageObject
  | TextObject
  | PixelTextObject
  | MobObject
  | LightObject
  | ModelObject
  | MirrorObject
  | LightningObject
  | VfxObject

export interface SceneSettings {
  renderMode: RenderMode
  ambientOcclusion: boolean
  fov: number
  fog: boolean
  exportWidth: number
  exportHeight: number
  /** JPG is what YouTube wants (kept under its 2 MB limit); PNG is lossless. */
  exportFormat: ExportFormat
  showGrid: boolean
  /** Always snap while moving (Shift does the same temporarily). */
  snap: boolean
  /** Sun direction in degrees; drives the main light and the god-rays sun. */
  sunAzimuth: number
  sunElevation: number
  /** Multipliers for the sun and the ambient fill in Cinematic mode (turn down for night scenes). */
  sunStrength: number
  ambientStrength: number
  /** How strongly torches, lava and glowstone light their surroundings in Cinematic mode. */
  blockGlow: number
  /** Water surfaces reflect the scene (planar reflection at the main water level). */
  waterReflections: boolean
  /** Rain or snow falling in 3D around the view, stopping at the ground like in game. */
  weather: WeatherType
  /** Share of block columns with rain or snow in them (vanilla fills all of them: 1). */
  weatherDensity: number
  /** Sideways lean of the falling rain or snow. */
  wind: number
  /** The user's saved camera ("shot"), to return to after looking around. */
  shot: (CameraState & { fov: number }) | null
}

export interface EffectSettings {
  exposure: number
  contrast: number
  saturation: number
  /** -1 cool/blue … +1 warm/orange */
  temperature: number
  /** -1 green … +1 magenta */
  tint: number
  shadowTint: string
  highlightTint: string
  /** Strength of shadow/highlight tinting */
  split: number
  vignette: boolean
  vignetteDarkness: number
  vignetteOffset: number
  grain: boolean
  grainAmount: number
  bloom: boolean
  bloomIntensity: number
  bloomThreshold: number
  godRays: boolean
  godRaysIntensity: number
  sunColor: string
  showSun: boolean
  chromatic: boolean
  chromaticAmount: number
  depthOfField: boolean
  dofBlur: number
  dofRange: number
  /** Where focus is taken from, in viewport fractions (x right, y down): whatever is under each point stays sharp. */
  focusPoints: { x: number; y: number }[]
  /** Always-on-top layers (titles) are drawn after the effects, so blur, grain, looks and lens effects skip them. */
  cleanOverlays: boolean
  /** CRT TV: scanlines and phosphor mask, a curved screen, and whether it also covers the always-on-top layers. */
  crt: boolean
  crtAmount: number
  crtCurve: number
  crtOverLayers: boolean
  /** Lens warp: + curves the image like a curved TV / fisheye, - pinches it; the frame always stays filled. */
  warp: boolean
  warpAmount: number
  /** Speed burst: a radial zoom blur toward a point (x right, y down), clear around it. */
  burst: boolean
  burstAmount: number
  burstClear: number
  burstX: number
  burstY: number
  /** Anamorphic streaks: horizontal light lines from bright spots. */
  streaks: boolean
  streakAmount: number
  streakThreshold: number
  streakColor: string
  /** The colour look (a 3D LUT): a built-in look's id, 'custom' for an imported .cube file, or null. */
  look: string | null
  /** 0 = original colour … 1 = the full look. */
  lookIntensity: number
  /** The imported .cube file (kept in the project like other media). */
  lutMediaId: string | null
  lutName: string
}

export const NO_EFFECTS: EffectSettings = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  shadowTint: '#808080',
  highlightTint: '#808080',
  split: 0,
  vignette: false,
  vignetteDarkness: 0.55,
  vignetteOffset: 0.3,
  grain: false,
  grainAmount: 0.12,
  bloom: false,
  bloomIntensity: 0.8,
  bloomThreshold: 0.75,
  godRays: false,
  godRaysIntensity: 0.8,
  sunColor: '#fff1c1',
  showSun: true,
  chromatic: false,
  chromaticAmount: 0.0015,
  depthOfField: false,
  dofBlur: 2,
  dofRange: 8,
  focusPoints: [{ x: 0.5, y: 0.55 }],
  cleanOverlays: true,
  crt: false,
  crtAmount: 0.6,
  crtCurve: 0.5,
  crtOverLayers: false,
  warp: false,
  warpAmount: 0.5,
  burst: false,
  burstAmount: 0.5,
  burstClear: 0.35,
  burstX: 0.5,
  burstY: 0.5,
  streaks: false,
  streakAmount: 0.6,
  streakThreshold: 1.2,
  streakColor: '#7fb8ff',
  look: null,
  lookIntensity: 1,
  lutMediaId: null,
  lutName: ''
}

export type SkyPreset =
  'biome' | 'clear' | 'golden' | 'sunset' | 'night' | 'overcast' | 'nether' | 'end' | 'color' | 'hdri'

export interface SkySettings {
  preset: SkyPreset
  /** Solid colour for the 'color' preset. */
  color: string
  /** Uploaded equirectangular image (.hdr/.exr/.jpg/.png) for the 'hdri' preset. */
  hdriMediaId: string | null
  hdriName: string
  /** Degrees around the vertical axis. */
  rotation: number
  /** Brightness multiplier for the backdrop. */
  intensity: number
  /** Light the scene with the sky (image-based lighting) in Cinematic mode. */
  lighting: boolean
}

export const DEFAULT_SKY: SkySettings = {
  preset: 'biome',
  color: '#78a7ff',
  hdriMediaId: null,
  hdriName: '',
  rotation: 0,
  intensity: 1,
  lighting: true
}

export interface ProjectInfo {
  id: string
  name: string
  /** Where the user last saved it with Save / Save as (autosaves go elsewhere). */
  path: string | null
  /** Unsaved changes since the last save or autosave. */
  dirty: boolean
  createdAt: number
}

export const newProjectInfo = (): ProjectInfo => ({
  id: newId('project'),
  name: 'Untitled thumbnail',
  path: null,
  dirty: false,
  createdAt: Date.now()
})

/** Terrain voxels are large, so they live outside the reactive state. */
export const terrainStore = new Map<string, TerrainData>()

export type TransformMode = 'translate' | 'rotate' | 'scale'

interface State {
  assets: AssetBundle | null
  objects: SceneObject[]
  /** The primary selection: the object the inspector shows and the toolbar follows. */
  selectedId: string | null
  /** Everything selected (Ctrl/Shift+click, box select, groups); includes `selectedId`. Read via `selection()`. */
  selectedIds: string[]
  /** A player joint picked in the viewport for rotating (only while that player is selected). */
  selectedJoint: PartName | null
  /** Clicking a player's arm or leg gives a handle on the hand/foot that moves the whole limb (IK). */
  ikMode: boolean
  transformMode: TransformMode
  settings: SceneSettings
  effects: EffectSettings
  sky: SkySettings
  project: ProjectInfo
  status: string
  /** Undo history: scene edits and camera moves. Terrain voxels are shared, not copied. */
  past: HistoryEntry[]
  future: HistoryEntry[]
  undo(): void
  redo(): void
  /** Records a camera move (call with the view from before the move). */
  recordCamera(before: CameraState, startedAt?: number): void
  setAssets(a: AssetBundle | null): void
  add(o: SceneObject): void
  duplicate(id: string): void
  update<T extends SceneObject>(id: string, patch: Partial<T>): void
  remove(id: string): void
  /** Selects one object (and the rest of its group), or nothing. */
  select(id: string | null): void
  /** Selects just this object, even inside a group (to edit one member). */
  selectOnly(id: string): void
  /** Ctrl/Shift+click: adds an object (and its group) to the selection, or takes it out. */
  toggleSelect(id: string): void
  /** Replaces the selection (box select, select all, layer ranges). */
  setSelection(ids: string[], primary?: string | null): void
  /** Moves, turns or resizes several objects as one undo step. */
  updateMany(patches: { id: string; patch: Partial<SceneObject> }[]): void
  removeSelected(): void
  duplicateSelected(): void
  groupSelected(): void
  ungroupSelected(): void
  selectJoint(joint: PartName | null): void
  setIkMode(on: boolean): void
  /** Move an object up/down in the layer stack (later = drawn on top for overlay layers). */
  reorder(id: string, delta: number): void
  setTransformMode(m: TransformMode): void
  setSettings(patch: Partial<SceneSettings>): void
  setEffects(patch: Partial<EffectSettings>): void
  setSky(patch: Partial<SkySettings>): void
  setProject(patch: Partial<ProjectInfo>): void
  setStatus(s: string): void
}

export interface CameraState {
  position: Vec3
  target: Vec3
}

/** One undo step: whatever the change replaced (the object list, the camera view, or both). */
export interface HistoryEntry {
  objects?: SceneObject[]
  camera?: CameraState
}

/** The viewport registers these so undo can read and restore the view. */
export const cameraBridge: { get: (() => CameraState | null) | null; set: ((c: CameraState) => void) | null } = {
  get: null,
  set: null
}

const sameCamera = (a: CameraState, b: CameraState): boolean =>
  [...a.position, ...a.target].every((v, i) => Math.abs(v - [...b.position, ...b.target][i]) < 1e-4)

/** Applies a history entry and returns the entry that reverses it. */
function applyEntry(s: State, e: HistoryEntry): { reverse: HistoryEntry; patch: Partial<State> } {
  const reverse: HistoryEntry = {}
  const patch: Partial<State> = {}
  if (e.objects) {
    reverse.objects = s.objects
    patch.objects = e.objects
    if (!e.objects.some((o) => o.id === s.selectedId)) {
      patch.selectedId = null
      patch.selectedJoint = null
    }
    patch.selectedIds = s.selectedIds.filter((id) => e.objects!.some((o) => o.id === id))
  }
  const now = e.camera && cameraBridge.get?.()
  if (e.camera && now) {
    reverse.camera = now
    cameraBridge.set?.(e.camera)
  }
  return { reverse, patch }
}

let counter = 0
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

// Rapid edits to the same thing (typing a number, dragging a slider) collapse into one undo step.
let lastCommit = { key: '', at: 0 }
/** An object and the rest of its group, in layer order. */
export function groupOf(objects: SceneObject[], id: string): string[] {
  const g = objects.find((o) => o.id === id)?.groupId
  return g ? objects.filter((o) => o.groupId === g).map((o) => o.id) : [id]
}

/** Every selected object id (falls back to the primary selection if the list was never set). */
export function selection(s: Pick<State, 'selectedId' | 'selectedIds'>): string[] {
  if (!s.selectedId) return s.selectedIds
  return s.selectedIds.includes(s.selectedId) ? s.selectedIds : [s.selectedId]
}

const history = (s: State, key: string): Pick<State, 'past' | 'future'> => {
  const now = Date.now()
  const merge = key === lastCommit.key && now - lastCommit.at < 600
  lastCommit = { key, at: now }
  if (merge) return { past: s.past, future: [] }
  return { past: [...s.past.slice(-99), { objects: s.objects }], future: [] }
}

/** Sun and fill for a night sky (your own lights do the work) and for daytime. */
export const NIGHT_LIGHTING = { sunStrength: 0, ambientStrength: 0.15 }
export const DAY_LIGHTING = { sunStrength: 1, ambientStrength: 1 }

export const DEFAULT_SETTINGS: SceneSettings = {
  renderMode: 'vanilla',
  ambientOcclusion: true,
  fov: 70,
  fog: true,
  exportWidth: 1280,
  exportHeight: 720,
  exportFormat: 'jpg',
  showGrid: true,
  snap: false,
  sunAzimuth: 35,
  sunElevation: 30,
  sunStrength: 1,
  ambientStrength: 1,
  blockGlow: 1.2,
  waterReflections: false,
  weather: 'none',
  weatherDensity: 0.6,
  wind: 0,
  shot: null
}

export const useStore = create<State>((set) => ({
  assets: null,
  objects: [],
  selectedId: null,
  selectedIds: [],
  selectedJoint: null,
  ikMode: false,
  transformMode: 'translate',
  settings: { ...DEFAULT_SETTINGS },
  effects: { ...NO_EFFECTS },
  sky: { ...DEFAULT_SKY },
  project: newProjectInfo(),
  status: '',
  past: [],
  future: [],
  undo: () =>
    set((s) => {
      const entry = s.past[s.past.length - 1]
      if (!entry) return s
      lastCommit = { key: '', at: 0 }
      const { reverse, patch } = applyEntry(s, entry)
      if (!Object.keys(reverse).length) return { past: s.past.slice(0, -1) }
      return { ...patch, past: s.past.slice(0, -1), future: [reverse, ...s.future] }
    }),
  redo: () =>
    set((s) => {
      const entry = s.future[0]
      if (!entry) return s
      lastCommit = { key: '', at: 0 }
      const { reverse, patch } = applyEntry(s, entry)
      if (!Object.keys(reverse).length) return { future: s.future.slice(1) }
      return { ...patch, past: [...s.past, reverse], future: s.future.slice(1) }
    }),
  recordCamera: (before, startedAt = Date.now()) =>
    set((s) => {
      const now = cameraBridge.get?.()
      if (!now || sameCamera(before, now)) return s
      // Moves in quick succession (zoom out, then orbit) undo together, back to where the view started.
      const gap = startedAt - lastCommit.at
      const merge = lastCommit.key === 'camera' && gap >= 0 && gap < 1000
      lastCommit = { key: 'camera', at: Date.now() }
      if (merge) return { future: [] }
      return { past: [...s.past.slice(-99), { camera: before }], future: [] }
    }),
  setAssets: (assets) => set({ assets }),
  add: (o) =>
    set((s) => ({ ...history(s, `add:${o.id}`), objects: [...s.objects, o], selectedId: o.id, selectedIds: [o.id] })),
  duplicate: (id) =>
    set((s) => {
      const o = s.objects.find((x) => x.id === id)
      if (!o) return s
      const copy = { ...structuredClone(o), id: newId('obj'), name: `${o.name} copy` } as SceneObject
      copy.position = [o.position[0] + 1, o.position[1], o.position[2] + 1]
      delete copy.groupId
      return {
        ...history(s, `dup:${copy.id}`),
        objects: [...s.objects, copy],
        selectedId: copy.id,
        selectedIds: [copy.id]
      }
    }),
  update: (id, patch) =>
    set((s) => ({
      ...history(s, `update:${id}:${Object.keys(patch).join(',')}`),
      objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SceneObject) : o))
    })),
  remove: (id) =>
    set((s) => {
      // Terrain voxels stay in terrainStore so the removal can be undone.
      return {
        ...history(s, `remove:${id}`),
        objects: s.objects.filter((x) => x.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        selectedJoint: s.selectedId === id ? null : s.selectedJoint
      }
    }),
  select: (selectedId) =>
    set((s) => ({
      selectedId,
      selectedIds: selectedId ? groupOf(s.objects, selectedId) : [],
      selectedJoint: selectedId === s.selectedId ? s.selectedJoint : null
    })),
  selectOnly: (id) =>
    set((s) => ({ selectedId: id, selectedIds: [id], selectedJoint: id === s.selectedId ? s.selectedJoint : null })),
  toggleSelect: (id) =>
    set((s) => {
      const current = selection(s)
      const members = groupOf(s.objects, id)
      if (current.includes(id)) {
        const rest = current.filter((x) => !members.includes(x))
        const primary = s.selectedId && rest.includes(s.selectedId) ? s.selectedId : (rest.at(-1) ?? null)
        return { selectedIds: rest, selectedId: primary, selectedJoint: null }
      }
      return {
        selectedIds: [...current, ...members.filter((x) => !current.includes(x))],
        selectedId: id,
        selectedJoint: null
      }
    }),
  setSelection: (ids, primary) =>
    set((s) => {
      const all = [...new Set(ids.flatMap((id) => groupOf(s.objects, id)))]
      const p = primary && all.includes(primary) ? primary : (all.at(-1) ?? null)
      return { selectedIds: all, selectedId: p, selectedJoint: p === s.selectedId ? s.selectedJoint : null }
    }),
  updateMany: (patches) =>
    set((s) => {
      const by = new Map(patches.map((p) => [p.id, p.patch]))
      return {
        ...history(s, `many:${patches.map((p) => p.id).join(',')}:${Object.keys(patches[0]?.patch ?? {}).join(',')}`),
        objects: s.objects.map((o) => (by.has(o.id) ? ({ ...o, ...by.get(o.id) } as SceneObject) : o))
      }
    }),
  removeSelected: () =>
    set((s) => {
      const gone = new Set(selection(s))
      if (!gone.size) return s
      return {
        ...history(s, `remove:${[...gone].join(',')}`),
        objects: s.objects.filter((o) => !gone.has(o.id)),
        selectedId: null,
        selectedIds: [],
        selectedJoint: null
      }
    }),
  duplicateSelected: () =>
    set((s) => {
      const ids = new Set(selection(s))
      if (!ids.size) return s
      // Copies of a group stay grouped with each other, not with the originals.
      const groups = new Map<string, string>()
      const copies = s.objects
        .filter((o) => ids.has(o.id))
        .map((o) => {
          const copy = { ...structuredClone(o), id: newId('obj'), name: `${o.name} copy` } as SceneObject
          copy.position = [o.position[0] + 1, o.position[1], o.position[2] + 1]
          if (o.groupId) {
            if (!groups.has(o.groupId)) groups.set(o.groupId, newId('grp'))
            copy.groupId = groups.get(o.groupId)
          }
          return copy
        })
      return {
        ...history(s, `dup:${copies.map((c) => c.id).join(',')}`),
        objects: [...s.objects, ...copies],
        selectedIds: copies.map((c) => c.id),
        selectedId: copies.at(-1)!.id,
        selectedJoint: null
      }
    }),
  groupSelected: () =>
    set((s) => {
      const ids = new Set(selection(s))
      if (ids.size < 2) return s
      const groupId = newId('grp')
      // Members sit together in the layer list, where the topmost of them was.
      const members = s.objects.filter((o) => ids.has(o.id)).map((o) => ({ ...o, groupId }) as SceneObject)
      const top = s.objects.reduce((t, o, i) => (ids.has(o.id) ? i : t), -1)
      const before = s.objects.slice(0, top + 1).filter((o) => !ids.has(o.id))
      const after = s.objects.slice(top + 1)
      return { ...history(s, `group:${groupId}`), objects: [...before, ...members, ...after] }
    }),
  ungroupSelected: () =>
    set((s) => {
      const ids = new Set(selection(s))
      if (!s.objects.some((o) => ids.has(o.id) && o.groupId)) return s
      return {
        ...history(s, `ungroup:${[...ids].join(',')}`),
        objects: s.objects.map((o) => {
          if (!ids.has(o.id) || !o.groupId) return o
          const rest = { ...o }
          delete rest.groupId
          return rest
        })
      }
    }),
  selectJoint: (selectedJoint) => set({ selectedJoint }),
  setIkMode: (ikMode) => set({ ikMode }),
  reorder: (id, delta) =>
    set((s) => {
      const i = s.objects.findIndex((o) => o.id === id)
      const j = Math.min(s.objects.length - 1, Math.max(0, i + delta))
      if (i < 0 || i === j) return s
      const objects = [...s.objects]
      const [o] = objects.splice(i, 1)
      objects.splice(j, 0, o)
      return { ...history(s, `reorder:${id}:${Date.now()}`), objects }
    }),
  setTransformMode: (transformMode) => set({ transformMode, selectedJoint: null }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setEffects: (patch) => set((s) => ({ effects: { ...s.effects, ...patch } })),
  setSky: (patch) => set((s) => ({ sky: { ...s.sky, ...patch } })),
  setProject: (patch) => set((s) => ({ project: { ...s.project, ...patch } })),
  setStatus: (status) => set({ status })
}))

export const defaultPose = (): Pose => structuredClone(POSES.Standing)

// Scene tracks: single numbers in the scene that change over time (the sun, the colour look, focus, an object's
// opacity), keyed like everything else on the timeline and played back with the animation.

/** Where a property lives. */
export type SceneTarget = 'settings' | 'effects' | 'object' | 'focus'

export interface ScenePropDef {
  label: string
  group: 'Light' | 'Look' | 'Focus' | 'Weather' | 'Object'
  target: SceneTarget
  /** The field on the settings, effects or object (for focus: 'x' or 'y' of the first focus point). */
  field: string
  min: number
  max: number
  step: number
  /** Jumps between keys instead of sliding (visibility). */
  hold?: boolean
  /** The switch that has to be on for the value to show; it is turned on while the track plays. */
  enable?: string
  /** Kinds of object that have the field. */
  kinds?: string[]
  /** Typed in as a number instead of dragged. */
  number?: boolean
}

export const SCENE_PROPS = {
  sunAzimuth: {
    label: 'Sun direction',
    group: 'Light',
    target: 'settings',
    field: 'sunAzimuth',
    min: 0,
    max: 360,
    step: 1
  },
  sunElevation: {
    label: 'Sun height',
    group: 'Light',
    target: 'settings',
    field: 'sunElevation',
    min: -10,
    max: 90,
    step: 1
  },
  sunStrength: {
    label: 'Sun strength',
    group: 'Light',
    target: 'settings',
    field: 'sunStrength',
    min: 0,
    max: 3,
    step: 0.05
  },
  ambientStrength: {
    label: 'Ambient light',
    group: 'Light',
    target: 'settings',
    field: 'ambientStrength',
    min: 0,
    max: 3,
    step: 0.05
  },
  blockGlow: {
    label: 'Block glow',
    group: 'Light',
    target: 'settings',
    field: 'blockGlow',
    min: 0,
    max: 3,
    step: 0.05
  },
  exposure: { label: 'Exposure', group: 'Look', target: 'effects', field: 'exposure', min: -2, max: 2, step: 0.05 },
  contrast: { label: 'Contrast', group: 'Look', target: 'effects', field: 'contrast', min: -1, max: 1, step: 0.05 },
  saturation: {
    label: 'Saturation',
    group: 'Look',
    target: 'effects',
    field: 'saturation',
    min: -1,
    max: 1,
    step: 0.05
  },
  temperature: {
    label: 'Temperature',
    group: 'Look',
    target: 'effects',
    field: 'temperature',
    min: -1,
    max: 1,
    step: 0.05
  },
  lookIntensity: {
    label: 'Look strength',
    group: 'Look',
    target: 'effects',
    field: 'lookIntensity',
    min: 0,
    max: 1,
    step: 0.02
  },
  vignette: {
    label: 'Vignette',
    group: 'Look',
    target: 'effects',
    field: 'vignetteDarkness',
    min: 0,
    max: 1,
    step: 0.02,
    enable: 'vignette'
  },
  grain: {
    label: 'Grain',
    group: 'Look',
    target: 'effects',
    field: 'grainAmount',
    min: 0,
    max: 1,
    step: 0.02,
    enable: 'grain'
  },
  bloom: {
    label: 'Bloom',
    group: 'Look',
    target: 'effects',
    field: 'bloomIntensity',
    min: 0,
    max: 3,
    step: 0.05,
    enable: 'bloom'
  },
  godRays: {
    label: 'God rays',
    group: 'Look',
    target: 'effects',
    field: 'godRaysIntensity',
    min: 0,
    max: 2,
    step: 0.05,
    enable: 'godRays'
  },
  chromatic: {
    label: 'Chromatic split',
    group: 'Look',
    target: 'effects',
    field: 'chromaticAmount',
    min: 0,
    max: 0.02,
    step: 0.0005,
    enable: 'chromatic'
  },
  burst: {
    label: 'Speed burst',
    group: 'Look',
    target: 'effects',
    field: 'burstAmount',
    min: 0,
    max: 1,
    step: 0.02,
    enable: 'burst'
  },
  warp: {
    label: 'Lens warp',
    group: 'Look',
    target: 'effects',
    field: 'warpAmount',
    min: -1,
    max: 1,
    step: 0.02,
    enable: 'warp'
  },
  dofBlur: {
    label: 'Blur amount',
    group: 'Focus',
    target: 'effects',
    field: 'dofBlur',
    min: 0,
    max: 10,
    step: 0.1,
    enable: 'depthOfField'
  },
  focusX: {
    label: 'Focus point across',
    group: 'Focus',
    target: 'focus',
    field: 'x',
    min: 0,
    max: 1,
    step: 0.01,
    enable: 'depthOfField'
  },
  focusY: {
    label: 'Focus point down',
    group: 'Focus',
    target: 'focus',
    field: 'y',
    min: 0,
    max: 1,
    step: 0.01,
    enable: 'depthOfField'
  },
  weatherDensity: {
    label: 'Rain / snow amount',
    group: 'Weather',
    target: 'settings',
    field: 'weatherDensity',
    min: 0,
    max: 1,
    step: 0.02
  },
  wind: { label: 'Wind', group: 'Weather', target: 'settings', field: 'wind', min: -1, max: 1, step: 0.02 },
  visible: {
    label: 'Visible',
    group: 'Object',
    target: 'object',
    field: 'visible',
    min: 0,
    max: 1,
    step: 1,
    hold: true
  },
  opacity: {
    label: 'Opacity',
    group: 'Object',
    target: 'object',
    field: 'opacity',
    min: 0,
    max: 1,
    step: 0.02,
    kinds: ['image', 'video', 'vfx']
  },
  size: { label: 'Size', group: 'Object', target: 'object', field: 'scale', min: 0.01, max: 20, step: 0.01 },
  typed: {
    label: 'Typewriter',
    group: 'Object',
    target: 'object',
    field: 'typed',
    min: 0,
    max: 1,
    step: 0.01,
    kinds: ['text', 'pixelText']
  },
  count: {
    label: 'Counter',
    group: 'Object',
    target: 'object',
    field: 'count',
    min: 0,
    max: 1000000,
    step: 1,
    kinds: ['text', 'pixelText'],
    number: true
  },
  reveal: {
    label: 'Build up',
    group: 'Object',
    target: 'object',
    field: 'reveal',
    min: 0,
    max: 1,
    step: 0.01,
    kinds: ['terrain', 'model', 'mob']
  },
  rim: {
    label: 'Rim light',
    group: 'Object',
    target: 'object',
    field: 'rimIntensity',
    min: 0,
    max: 4,
    step: 0.05,
    kinds: ['player', 'mob', 'model', 'pixelText', 'terrain']
  },
  density: {
    label: 'Effect amount',
    group: 'Object',
    target: 'object',
    field: 'density',
    min: 0,
    max: 1,
    step: 0.02,
    kinds: ['vfx']
  }
} satisfies Record<string, ScenePropDef>

export type ScenePropId = keyof typeof SCENE_PROPS
export const SCENE_PROP_IDS = Object.keys(SCENE_PROPS) as ScenePropId[]
export const propDef = (p: string): ScenePropDef | undefined => (SCENE_PROPS as Record<string, ScenePropDef>)[p]

export interface SceneKey {
  t: number
  v: number
}

export interface SceneTrack {
  id: string
  prop: ScenePropId
  /** For object properties: whose. */
  objectId?: string
  keys: SceneKey[]
}

const smooth = (x: number): number => x * x * (3 - 2 * x)

/** The value at `t`: eased between keys, held at the ends; null with no keys. */
export function sampleScene(track: Pick<SceneTrack, 'prop' | 'keys'>, t: number): number | null {
  const ks = track.keys
  if (!ks.length) return null
  if (t <= ks[0].t) return ks[0].v
  const last = ks[ks.length - 1]
  if (t >= last.t) return last.v
  let i = 0
  while (ks[i + 1].t <= t) i++
  const a = ks[i]
  const b = ks[i + 1]
  if (propDef(track.prop)?.hold) return a.v
  return a.v + (b.v - a.v) * smooth((t - a.t) / Math.max(1e-6, b.t - a.t))
}

/** Puts a key in, replacing one at (about) the same time, and keeps them in order. */
export function putSceneKey(keys: SceneKey[], key: SceneKey): SceneKey[] {
  const out = keys.filter((k) => Math.abs(k.t - key.t) > 1e-3)
  out.push({ t: Math.max(0, key.t), v: key.v })
  return out.sort((a, b) => a.t - b.t)
}

export const clampScene = (prop: string, v: number): number => {
  const d = propDef(prop)
  return d ? Math.min(d.max, Math.max(d.min, v)) : v
}

/** Drops anything that isn't a proper track (a project from elsewhere, an older save). */
export function cleanSceneTracks(raw: unknown): SceneTrack[] {
  if (!Array.isArray(raw)) return []
  const out: SceneTrack[] = []
  for (const r of raw as Partial<SceneTrack>[]) {
    if (!r || typeof r.id !== 'string' || !r.prop || !propDef(r.prop) || !Array.isArray(r.keys)) continue
    const keys = r.keys
      .filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.v))
      .map((k) => ({ t: Math.max(0, k.t), v: clampScene(r.prop!, k.v) }))
      .sort((a, b) => a.t - b.t)
    out.push({ id: r.id, prop: r.prop, objectId: typeof r.objectId === 'string' ? r.objectId : undefined, keys })
  }
  return out
}

/** Which tracks show the value of an object kind (visibility fits all). */
export const fitsKind = (prop: ScenePropId, kind: string): boolean => {
  const d = SCENE_PROPS[prop] as ScenePropDef
  return d.target !== 'object' || !d.kinds || d.kinds.includes(kind)
}

/** The time the last key is at: the animation lasts at least this long. */
export const sceneLength = (tracks: SceneTrack[] | undefined): number =>
  Math.max(0, ...(tracks ?? []).map((tr) => tr.keys.at(-1)?.t ?? 0))

/** The text a typewriter or counter track shows at value `v`, for text that is `full` when done. */
export const typedText = (full: string, v: number): string =>
  full.slice(0, Math.round(Math.min(1, Math.max(0, v)) * full.length))
export const countText = (v: number): string => String(Math.round(v))

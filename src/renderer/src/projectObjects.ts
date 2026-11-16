// Checks the objects of a project file before they reach the scene. A project saved by an older version, edited by
// hand or damaged can miss a field or hold the wrong kind of value; drawing it as it is would crash the viewport.
// Every object comes out with a value of the right kind in each field the scene needs (the value it would have had
// when new), and an object that can't be drawn at all is left out.
import { fullPose } from '@shared/minecraft/playerModel'
import { STICKERS } from './stickers'
import { newId, type SceneObject, type Vec3 } from './store'
import { VFX_PRESETS } from './vfx'

type Raw = Record<string, unknown>
type Check = (v: unknown) => boolean

const str: Check = (v) => typeof v === 'string'
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const positive: Check = (v) => num(v) && (v as number) > 0
const bool: Check = (v) => typeof v === 'boolean'
const oneOf =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v)

const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every(num) ? (v as Vec3) : null)

/** What each kind needs to be drawn: the check a field must pass and the value a new object starts with. */
const FIELDS: Record<string, Record<string, [Check, unknown]>> = {
  terrain: {},
  player: { slim: [bool, false] },
  image: { aspect: [positive, 1], opacity: [num, 1], onTop: [bool, false] },
  video: { aspect: [positive, 1], opacity: [num, 1], onTop: [bool, false] },
  text: {
    text: [str, ''],
    color: [str, '#ffffff'],
    outlineColor: [str, '#000000'],
    outlineWidth: [num, 14],
    font: [str, 'sans-serif'],
    shadow: [bool, true],
    onTop: [bool, true]
  },
  pixelText: { text: [str, ''], color: [str, '#ffffff'], depth: [positive, 2], shadow: [bool, true] },
  mob: {},
  light: {
    lightType: [oneOf('point', 'spot'), 'point'],
    color: [str, '#ffffff'],
    intensity: [num, 40],
    range: [num, 20],
    angle: [num, 50],
    softness: [num, 0.5],
    shadows: [bool, false]
  },
  model: {},
  mirror: { width: [positive, 2], height: [positive, 3], tint: [str, '#e6e6e6'], frame: [bool, true] },
  lightning: { seed: [num, 1], color: [str, '#737380'], brightness: [num, 1.5], flash: [bool, true] },
  vfx: {
    effect: [oneOf(...VFX_PRESETS.map((p) => p.id)), 'smoke'],
    color: [str, '#ffffff'],
    density: [num, 0.5],
    opacity: [num, 1],
    glow: [bool, false],
    seed: [num, 1]
  },
  sticker: {
    shape: [oneOf(...STICKERS.map((s) => s.id)), 'arrow'],
    color: [str, '#ff2a2a'],
    outline: [bool, true],
    glow: [bool, false]
  }
}

export interface ObjectCheck {
  objects: SceneObject[]
  /** How many objects were left out because they can't be drawn (an unknown kind, missing terrain or model). */
  dropped: number
  /** How many had a field put right. */
  repaired: number
}

/**
 * The objects of a project file, safe to draw. `has` says which terrains and media files the project carries.
 */
export function checkObjects(
  list: unknown[],
  has: { terrain(id: string): boolean; media(id: string): boolean }
): ObjectCheck {
  const objects: SceneObject[] = []
  const ids = new Set<string>()
  let dropped = 0
  let repaired = 0
  for (const item of list) {
    const fields = item && typeof item === 'object' ? FIELDS[String((item as Raw).kind)] : undefined
    if (!fields) {
      dropped++
      continue
    }
    const o: Raw = { ...(item as Raw) }
    let fixed = false
    const set = (key: string, ok: boolean, value: () => unknown): void => {
      if (ok) return
      o[key] = value()
      fixed = true
    }
    set('id', str(o.id) && o.id !== '' && !ids.has(o.id as string), () => newId('obj'))
    ids.add(o.id as string)
    set('name', str(o.name), () => String(o.kind))
    set('visible', bool(o.visible), () => true)
    set('position', !!vec3(o.position), () => [0, 0, 0])
    set('rotation', !!vec3(o.rotation), () => [0, 0, 0])
    set('scale', positive(o.scale), () => 1)
    for (const [key, [ok, value]] of Object.entries(fields)) set(key, ok(o[key]), () => value)

    // What an object can't do without: left out when it is missing.
    let drawable = true
    if (o.kind === 'terrain') drawable = str(o.terrainId) && has.terrain(o.terrainId as string)
    else if (o.kind === 'mob') {
      drawable = str(o.layer) && str(o.texture)
      set('partRotations', !!o.partRotations && typeof o.partRotations === 'object', () => ({}))
    } else if (o.kind === 'model') {
      drawable = str(o.mediaId) && has.media(o.mediaId as string)
      set('extraMediaIds', Array.isArray(o.extraMediaIds) && o.extraMediaIds.every(str), () => [])
    } else if (o.kind === 'player') {
      // Also fills in the elbows and knees that older projects don't have.
      const joints = Object.entries(o.pose && typeof o.pose === 'object' ? o.pose : {}).filter(([, v]) => vec3(v))
      o.pose = fullPose(Object.fromEntries(joints))
    } else if (o.kind === 'light') set('gobo', o.gobo === null || str(o.gobo), () => null)
    if (!drawable) {
      dropped++
      continue
    }
    if (fixed) repaired++
    objects.push(o as unknown as SceneObject)
  }
  return { objects, dropped, repaired }
}

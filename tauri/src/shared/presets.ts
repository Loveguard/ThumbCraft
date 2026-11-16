// Presets: blocks saved from the timeline to use again, on any character, and shared as files. A preset keeps its
// blocks' timing and, for blocks that move, their paths relative to where the first one starts and which way it
// faces, so it plays from wherever the next character happens to be standing.
import { CLIPS, canLayer, type Clip, type ClipMode, type ClipType, type Vec3 } from './animation'
import { CAMS, type CamClip, type CamType } from './camera'

export interface PresetClip {
  type: ClipType
  /** Seconds after the start of the preset. */
  offset: number
  duration: number
  mode?: ClipMode
  auto?: boolean
  layer?: 'upper'
  /** In the character's own frame at the start: x to its left, y up, z forward. */
  path?: Vec3[]
  target?: Vec3
  hand?: 'left' | 'right'
  face?: number
}

export interface PresetCam {
  type: CamType
  offset: number
  duration: number
  amount?: number
  /** Frames the character it is played on (not a fixed one). */
  self: boolean
}

export interface Preset {
  id: string
  name: string
  duration: number
  clips: PresetClip[]
  camera?: PresetCam[]
}

export interface PresetPack {
  format: 'thumbcraft-presets'
  version: 1
  name: string
  presets: Preset[]
}

export interface Origin {
  position: Vec3
  /** Radians, 0 faces +Z. */
  yaw: number
}

const round = (v: number): number => Math.round(v * 1000) / 1000

/** A point in the world as seen from `o`: x to the character's left, z ahead. */
export function toFrame(p: Vec3, o: Origin): Vec3 {
  const dx = p[0] - o.position[0]
  const dz = p[2] - o.position[2]
  const s = Math.sin(o.yaw)
  const c = Math.cos(o.yaw)
  return [round(dx * c - dz * s), round(p[1] - o.position[1]), round(dx * s + dz * c)]
}

/** The world point for a point in `o`'s frame. */
export function fromFrame(p: Vec3, o: Origin): Vec3 {
  const s = Math.sin(o.yaw)
  const c = Math.cos(o.yaw)
  return [
    round(o.position[0] + p[0] * c + p[2] * s),
    round(o.position[1] + p[1]),
    round(o.position[2] - p[0] * s + p[2] * c)
  ]
}

/** Makes a preset from blocks (and the camera blocks over the same time, if given). */
export function presetFrom(
  name: string,
  clips: Clip[],
  origin: Origin,
  cams: (CamClip & { self?: boolean })[] = [],
  id = crypto.randomUUID()
): Preset {
  const t0 = Math.min(...clips.map((c) => c.start))
  const end = Math.max(...clips.map((c) => c.start + c.duration))
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  return {
    id,
    name,
    duration: round(end - t0),
    clips: sorted.map((c) => ({
      type: c.type,
      offset: round(c.start - t0),
      duration: round(c.duration),
      ...(c.mode ? { mode: c.mode } : {}),
      ...(c.auto === false ? { auto: false } : {}),
      ...(c.layer ? { layer: c.layer } : {}),
      ...(c.path?.length ? { path: c.path.map((p) => toFrame(p, origin)) } : {}),
      ...(c.target ? { target: toFrame(c.target, origin) } : {}),
      ...(c.hand ? { hand: c.hand } : {}),
      ...(c.face !== undefined ? { face: round(c.face - origin.yaw) } : {})
    })),
    ...(cams.length
      ? {
          camera: cams
            .filter((c) => c.start + c.duration > t0 && c.start < end)
            .map((c) => ({
              type: c.type,
              offset: round(Math.max(0, c.start - t0)),
              duration: round(c.duration),
              ...(c.amount !== undefined ? { amount: c.amount } : {}),
              self: c.self ?? !!c.subject
            }))
        }
      : {})
  }
}

/** The blocks of a preset as they play on a character that stands at `origin` when it starts at time `at`. */
export function clipsFrom(p: Preset, at: number, origin: Origin): Clip[] {
  return p.clips.map((c) => ({
    id: crypto.randomUUID(),
    type: c.type,
    start: round(at + c.offset),
    duration: c.duration,
    ...(c.mode ? { mode: c.mode } : {}),
    ...(c.auto === false ? { auto: false } : {}),
    ...(c.layer ? { layer: c.layer } : {}),
    ...(c.path ? { path: c.path.map((q) => fromFrame(q, origin)) } : {}),
    ...(c.target ? { target: fromFrame(c.target, origin) } : {}),
    ...(c.hand ? { hand: c.hand } : {}),
    ...(c.face !== undefined ? { face: round(c.face + origin.yaw) } : {}),
    ...(c.path ? { exact: true } : {})
  }))
}

// ------------------------------------------------------------------ files

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vec = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 && v.every(finite) ? ([v[0], v[1], v[2]] as Vec3) : null

/** A preset from untrusted data (a file someone sent): only known blocks and sane numbers get through. */
export function cleanPreset(raw: unknown): Preset | null {
  const r = raw as Partial<Preset> | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.clips)) return null
  const clips: PresetClip[] = []
  for (const c of r.clips.slice(0, 200) as Partial<PresetClip>[]) {
    if (!c || typeof c.type !== 'string' || !(c.type in CLIPS)) continue
    if (!finite(c.offset) || !finite(c.duration) || c.offset < 0 || c.duration <= 0 || c.duration > 600) continue
    const def = CLIPS[c.type]
    const out: PresetClip = { type: c.type, offset: round(c.offset), duration: round(c.duration) }
    if (c.mode && def.modes.includes(c.mode)) out.mode = c.mode
    if (c.auto === false) out.auto = false
    if (c.layer === 'upper' && canLayer(c.type)) out.layer = 'upper'
    if (Array.isArray(c.path)) {
      const path = c.path.slice(0, 200).map(vec)
      if (path.every((p): p is Vec3 => !!p)) out.path = path
    }
    const target = vec(c.target)
    if (target) out.target = target
    if (c.hand === 'left' || c.hand === 'right') out.hand = c.hand
    if (finite(c.face)) out.face = c.face
    clips.push(out)
  }
  if (!clips.length) return null
  const camera: PresetCam[] = []
  for (const c of (Array.isArray(r.camera) ? r.camera : []).slice(0, 50) as Partial<PresetCam>[]) {
    if (!c || typeof c.type !== 'string' || !(c.type in CAMS) || !finite(c.offset) || !finite(c.duration)) continue
    if (c.offset < 0 || c.duration <= 0 || c.duration > 600) continue
    camera.push({
      type: c.type,
      offset: round(c.offset),
      duration: round(c.duration),
      ...(finite(c.amount) ? { amount: c.amount } : {}),
      self: !!c.self
    })
  }
  const duration = Math.max(...clips.map((c) => c.offset + c.duration))
  return {
    id: typeof r.id === 'string' && r.id.length < 80 ? r.id : crypto.randomUUID(),
    name: (typeof r.name === 'string' ? r.name : 'Preset').slice(0, 80) || 'Preset',
    duration: round(duration),
    clips,
    ...(camera.length ? { camera } : {})
  }
}

export function packToBytes(name: string, presets: Preset[]): Uint8Array {
  const pack: PresetPack = { format: 'thumbcraft-presets', version: 1, name, presets }
  return new TextEncoder().encode(JSON.stringify(pack, null, 2))
}

/** The presets in a pack file; throws a readable error when it is not one. */
export function packFromBytes(bytes: Uint8Array): { name: string; presets: Preset[] } {
  let data: Partial<PresetPack>
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('That is not a ThumbCraft preset pack.')
  }
  if (data?.format !== 'thumbcraft-presets' || !Array.isArray(data.presets))
    throw new Error('That is not a ThumbCraft preset pack.')
  const presets = data.presets.slice(0, 500).flatMap((p) => cleanPreset(p) ?? [])
  if (!presets.length) throw new Error('That pack has no presets in it.')
  return { name: (typeof data.name === 'string' ? data.name : 'Preset pack').slice(0, 80), presets }
}

// ------------------------------------------------------------------ starters

const starter = (id: string, name: string, steps: [ClipType, number, ClipMode?][]): Preset => {
  let at = 0
  const clips = steps.map(([type, duration, mode]): PresetClip => {
    const c: PresetClip = { type, offset: Math.round(at * 1000) / 1000, duration, ...(mode ? { mode } : {}) }
    at += duration
    return c
  })
  return { id: `starter:${id}`, name, duration: Math.round(at * 1000) / 1000, clips }
}

/** Ready-made sequences that come with the app: plain blocks, in a row, to add to any character and change. */
export const STARTER_PRESETS: Preset[] = [
  starter('victory', 'Victory', [
    ['cheer', 2.5],
    ['clap', 2],
    ['jump', 1.2]
  ]),
  starter('duel', 'Sword duel', [
    ['slash', 1.4],
    ['block', 1.6, 'hold'],
    ['slash', 1.4],
    ['slash', 1.4]
  ]),
  starter('boxing', 'Fist fight', [
    ['punch', 1.2],
    ['punch', 1.2],
    ['block', 1.5, 'hold'],
    ['punch', 1.2]
  ]),
  starter('boss', 'Boss intro', [
    ['walk', 3],
    ['idle', 1.5],
    ['point', 2],
    ['laugh', 2]
  ]),
  starter('spooked', 'Spooked and gone', [
    ['idle', 1],
    ['hit', 0.9],
    ['panic', 2],
    ['run', 2.5]
  ]),
  starter('sneak', 'Sneak attack', [
    ['sneak', 3],
    ['idle', 0.6],
    ['slash', 1.4],
    ['run', 2]
  ]),
  starter('knockout', 'Knocked out', [
    ['hit', 0.9],
    ['fall', 3]
  ]),
  starter('nap', 'Nap', [
    ['sit', 2, 'hold'],
    ['sleep', 4]
  ]),
  starter('think', 'Figuring it out', [
    ['think', 2.5],
    ['nod', 1.2],
    ['point', 1.5]
  ]),
  starter('hello', 'Polite hello', [
    ['walk', 2.5],
    ['wave', 2],
    ['bow', 2]
  ])
]

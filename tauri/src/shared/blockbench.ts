// Blockbench animations (the .animation.json files it saves for Bedrock models) in and out: a character's joints as
// bone rotations over time, and where it goes as a "root" bone's position. Plain data in, plain data out.
import { PART_NAMES, fullPose, type PartName, type Pose } from './minecraft/playerModel'
import type { Vec3 } from './animation'

/** The bone each joint is called (the forearms and shins are ours; a vanilla player has just the four limbs). */
export const BONE_OF: Record<PartName, string> = {
  head: 'head',
  body: 'body',
  rightArm: 'right_arm',
  rightForearm: 'right_forearm',
  leftArm: 'left_arm',
  leftForearm: 'left_forearm',
  rightLeg: 'right_leg',
  rightShin: 'right_shin',
  leftLeg: 'left_leg',
  leftShin: 'left_shin'
}

const key = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, '')
const PART_OF = new Map<string, PartName>([
  ...PART_NAMES.map((p): [string, PartName] => [key(BONE_OF[p]), p]),
  ['rightlowerarm', 'rightForearm'],
  ['leftlowerarm', 'leftForearm'],
  ['rightlowerleg', 'rightShin'],
  ['leftlowerleg', 'leftShin'],
  ['rightcalf', 'rightShin'],
  ['leftcalf', 'leftShin']
])

/** Joint angles between ours and Blockbench's: turning and tilting sideways go the other way round. */
const neg = (v: number): number => (v === 0 ? 0 : -v)
const flip = (v: Vec3): Vec3 => [v[0], neg(v[1]), neg(v[2])]

export interface Sample {
  t: number
  pose: Pose
  /** Where the character is, relative to where it started, in its own frame (x left, z forward), blocks. */
  root?: Vec3
}

const stamp = (t: number): string => String(Math.round(t * 10000) / 10000)
const round = (v: number): number => Math.round(v * 1000) / 1000

/** The file for one animation of a character. */
export function toBlockbench(name: string, samples: Sample[], opts: { loop: boolean }): unknown {
  const bones: Record<string, { rotation: Record<string, Vec3>; position?: Record<string, Vec3> }> = {}
  for (const part of PART_NAMES) {
    const rotation: Record<string, Vec3> = {}
    for (const s of samples) rotation[stamp(s.t)] = flip(s.pose[part]).map(round) as Vec3
    bones[BONE_OF[part]] = { rotation }
  }
  if (samples.some((s) => s.root)) {
    const position: Record<string, Vec3> = {}
    for (const s of samples) {
      const r = s.root ?? [0, 0, 0]
      position[stamp(s.t)] = [-r[0] * 16, r[1] * 16, r[2] * 16].map(round) as Vec3
    }
    bones.root = { rotation: {}, position }
  }
  return {
    format_version: '1.8.0',
    animations: {
      [`animation.${name.replace(/[^a-z0-9_.-]+/gi, '_') || 'thumbcraft'}`]: {
        loop: opts.loop,
        animation_length: samples.length ? Math.round(samples[samples.length - 1].t * 10000) / 10000 : 0,
        bones
      }
    }
  }
}

export interface Imported {
  name: string
  length: number
  loop: boolean
  samples: Sample[]
  /** Things in the file this can't use (formulas instead of numbers, bones it doesn't know). */
  skipped: string[]
}

type Track = [number, Vec3][]

function number(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function vec3(v: unknown): Vec3 | null {
  const a = Array.isArray(v) ? v : typeof v === 'number' || typeof v === 'string' ? [v, v, v] : null
  if (!a || a.length !== 3) return null
  const n = a.map(number)
  return n.every((x) => x !== null) ? (n as Vec3) : null
}

function trackOf(raw: unknown, skipped: Set<string>, label: string): Track {
  const out: Track = []
  if (Array.isArray(raw) || typeof raw !== 'object' || raw === null) {
    // A single value for the whole animation.
    const v = vec3(raw)
    if (v) out.push([0, v])
    else if (raw !== undefined && raw !== null) skipped.add(label)
    return out
  }
  for (const [time, frame] of Object.entries(raw as Record<string, unknown>)) {
    const t = Number(time)
    if (!Number.isFinite(t)) continue
    // A frame is a list of three, or { pre, post } (the value after the key is what plays on).
    const f = frame as { post?: unknown; pre?: unknown } | null
    const v = vec3(f && !Array.isArray(f) && typeof f === 'object' ? (f.post ?? f.pre) : frame)
    if (v) out.push([t, v])
    else skipped.add(label)
  }
  return out.sort((a, b) => a[0] - b[0])
}

function at(track: Track, t: number, fallback: Vec3): Vec3 {
  if (!track.length) return fallback
  if (t <= track[0][0]) return track[0][1]
  if (t >= track[track.length - 1][0]) return track[track.length - 1][1]
  let i = 0
  while (track[i + 1][0] < t) i++
  const [t0, a] = track[i]
  const [t1, b] = track[i + 1]
  const u = (t - t0) / Math.max(1e-9, t1 - t0)
  return a.map((v, j) => v + (b[j] - v) * u) as Vec3
}

/** The animations in a Blockbench file, each as joint poses over time. */
export function fromBlockbench(text: string): Imported[] {
  let data: {
    animations?: Record<string, { animation_length?: unknown; loop?: unknown; bones?: Record<string, unknown> }>
  }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That is not a Blockbench animation file.')
  }
  if (!data || typeof data !== 'object' || !data.animations || typeof data.animations !== 'object')
    throw new Error('That file has no animations in it.')
  const out: Imported[] = []
  for (const [name, anim] of Object.entries(data.animations).slice(0, 50)) {
    const skipped = new Set<string>()
    const tracks = new Map<PartName, Track>()
    let root: Track = []
    for (const [bone, value] of Object.entries(anim?.bones ?? {})) {
      const body = value as { rotation?: unknown; position?: unknown }
      const part = PART_OF.get(key(bone))
      if (part)
        tracks.set(
          part,
          trackOf(body.rotation, skipped, `${bone} rotation`).map(([t, v]) => [t, flip(v)])
        )
      else if (key(bone) === 'root') root = trackOf(body.position, skipped, 'root position')
      else if (body.rotation !== undefined || body.position !== undefined)
        skipped.add(`${bone} (not a bone of the player)`)
    }
    const times = new Set<number>()
    for (const tr of [...tracks.values(), root]) for (const [t] of tr) times.add(Math.round(t * 10000) / 10000)
    if (!tracks.size && !root.length) continue
    const length = number(anim?.animation_length) ?? Math.max(0, ...times)
    times.add(0)
    const samples: Sample[] = [...times]
      .sort((a, b) => a - b)
      .map((t) => {
        const pose = fullPose({})
        for (const [part, tr] of tracks) pose[part] = at(tr, t, [0, 0, 0]).map(round) as Vec3
        const r = root.length ? at(root, t, [0, 0, 0]) : undefined
        return { t, pose, ...(r ? { root: [-r[0] / 16, r[1] / 16, r[2] / 16].map(round) as Vec3 } : {}) }
      })
    out.push({
      name: name.replace(/^animation\./, ''),
      length,
      loop: anim?.loop === true,
      samples,
      skipped: [...skipped].slice(0, 10)
    })
  }
  if (!out.length) throw new Error('None of the bones in that file match a player (head, body, arms and legs).')
  return out
}

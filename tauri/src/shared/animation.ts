// Character animation: keyframes, smooth playback between them, and walk / run / sprint cycles generated along a
// path. Everything here is plain data and maths (no scene), so it is tested on its own.
import * as THREE from 'three'
import { cameraLength, type CameraData } from './camera'
import { reachPose } from './ik'
import { sceneLength, type SceneTrack } from './sceneTracks'
import { fullPose, PART_NAMES, PLAYER_PIXEL, type Pose } from './minecraft/playerModel'

export type Vec3 = [number, number, number]
export type Gait = 'sneak' | 'walk' | 'run' | 'sprint' | 'swim' | 'climb'

/** Where an object is, how it is turned (degrees, like objects) and, for characters, how it is posed at time `t`. */
export interface AnimKey {
  /** Seconds from the start. */
  t: number
  position: Vec3
  rotation: Vec3
  /** Players: every joint, in degrees. */
  pose?: Pose
  /** Mobs: extra rotation per model part, like `MobObject.partRotations`. */
  parts?: Record<string, Vec3>
}

/** The path a character was sent along; kept so the motion can be made again with another gait or speed. */
export interface AnimPath {
  /** Points on the ground, in order. */
  points: Vec3[]
  gait: Gait
  /** Multiplies the gait's own speed. */
  speed: number
  /** When the character sets off, in seconds. */
  start: number
  /** Takes exactly this long (the length of its block); otherwise it goes at the gait's own speed. */
  duration?: number
  /** Gets up to speed at the start / slows to a stop at the end (false when another block carries on from it). */
  easeIn?: boolean
  easeOut?: boolean
  /** Where in the step cycle it starts (radians), to carry on from a block that ended mid-step. */
  phase?: number
  /** Faces this way (radians) the whole time, whatever way the path goes (a climber faces the wall). */
  heading?: number
}

/** What a block on the timeline does. */
export type ClipType =
  | 'walk'
  | 'run'
  | 'sprint'
  | 'sneak'
  | 'swim'
  | 'climb'
  | 'leap'
  | 'idle'
  | 'point'
  | 'jump'
  | 'shrug'
  | 'wave'
  | 'mine'
  | 'chop'
  | 'eat'
  | 'nod'
  | 'shake'
  | 'laugh'
  | 'panic'
  | 'cower'
  | 'facepalm'
  | 'bow'
  | 'sit'
  | 'reach'
  | 'hit'
  | 'punch'
  | 'slash'
  | 'block'
  | 'cheer'
  | 'clap'
  | 'think'
  | 'fall'
  | 'sleep'

/** How a block plays: over and over to fill its length, once through, or up to its pose and held there. */
export type ClipMode = 'loop' | 'once' | 'hold'

/** A block on a character's row of the timeline: what it does, when, and for how long. */
export interface Clip {
  id: string
  type: ClipType
  /** Seconds from the start of the animation. */
  start: number
  duration: number
  /** Walking, running and sprinting: where it goes after where the previous block left it, in order. */
  path?: Vec3[]
  /** Actions: loop, once or hold (default: the first of the type's modes). */
  mode?: ClipMode
  /** Walk blocks: false keeps a walk a walk, however fast the length makes it go (default: speeds up to a run). */
  auto?: boolean
  /** On the upper-body row: plays over what the row below is doing, on the head, body and arms only. */
  layer?: 'upper'
  /** Reach: the spot (a world point) the hand goes to, and which hand. */
  target?: Vec3
  hand?: 'left' | 'right'
  /** Made by Go to: its points are exact heights, so the ground only corrects them a little. */
  exact?: boolean
  /** Climb: the way to face (radians, 0 faces +Z), toward the wall the ladder is on. */
  face?: number
}

export interface AnimTrack {
  objectId: string
  /** Sorted by time. With clips, these are made from them (`compileClips`) and rebuilt whenever they change. */
  keys: AnimKey[]
  path?: AnimPath | null
  /** The blocks on this character's row. A track without any is plain keys, set by hand. */
  clips?: Clip[]
  /** Always turns the head toward this (another character, or the camera), by `amount` (0…1). */
  look?: { target: string | 'camera'; amount: number } | null
  /** Breathes (default on for characters with blocks). */
  breathe?: boolean
  /** Bobs the head along with how loud the animation's sound is, by `amount` (0…1). */
  talk?: { amount: number } | null
}

/** A sound laid on the timeline: where it starts, how to draw it and the beats found in it. */
export interface AudioTrack {
  /** The sound's bytes, kept with the project's media. */
  mediaId: string
  name: string
  /** Seconds into the animation where the sound starts (below zero skips the start of the sound). */
  offset: number
  volume: number
  length: number
  /** The loudest sample of each equal slice of the sound (0…1), for the waveform. */
  peaks: number[]
  /** How loud it is `LEVEL_RATE` times a second (0…1). */
  env: number[]
  bpm: number | null
  /** Seconds from the start of the sound. */
  beats: number[]
  /** Blocks snap to the beats as they are dragged. */
  snap: boolean
}

export interface AnimationData {
  /** The sound the animation plays along with. */
  audio?: AudioTrack | null
  fps: number
  loop: boolean
  tracks: AnimTrack[]
  /** The camera's row of blocks. */
  camera?: CameraData | null
  /** Single numbers in the scene that change over time (the sun, the look, focus, an object's opacity). */
  scene?: SceneTrack[]
}

export const NO_ANIMATION: AnimationData = { fps: 30, loop: true, tracks: [] }

/** The animation's length: its last key, and never under a second. */
export const animationLength = (a: AnimationData | null | undefined): number =>
  Math.max(1, cameraLength(a?.camera), sceneLength(a?.scene), ...(a?.tracks ?? []).map((t) => t.keys.at(-1)?.t ?? 0))

// ------------------------------------------------------------------ playback

/** The state of a track at time `t`: smooth (Catmull-Rom) through the keys, easing in and out at the ends. */
export interface AnimState {
  position: Vec3
  rotation: Vec3
  quaternion: THREE.Quaternion
  pose?: Pose
  parts?: Record<string, Vec3>
}

const D2R = Math.PI / 180

export function quaternionOf(rotation: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0] * D2R, rotation[1] * D2R, rotation[2] * D2R, 'XYZ')
  )
}

export function rotationOf(q: THREE.Quaternion): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return [e.x, e.y, e.z].map((v) => Math.round((v / D2R) * 1000) / 1000) as Vec3
}

/**
 * Cubic Hermite between keys i and i+1 at fraction u, with Catmull-Rom slopes measured in time (so unevenly spaced
 * keys still move smoothly). The first and last keys have zero slope: the motion eases out of and into them.
 */
function hermite(times: number[], values: number[][], i: number, u: number, monotone: number[] = []): number[] {
  const n = times.length
  const t1 = times[i]
  const t2 = times[i + 1]
  const dt = t2 - t1
  const slope = (j: number, d: number): number => {
    if (j <= 0 || j >= n - 1) return 0
    const centred = (values[j + 1][d] - values[j - 1][d]) / (times[j + 1] - times[j - 1])
    if (!monotone.includes(d)) return centred
    // Height never dips below a step it has just come down, or rises above one: flat at every turning point, and
    // never steeper than three times the shallower side.
    const before = (values[j][d] - values[j - 1][d]) / (times[j] - times[j - 1])
    const after = (values[j + 1][d] - values[j][d]) / (times[j + 1] - times[j])
    if (before * after <= 0) return 0
    return Math.sign(centred) * Math.min(Math.abs(centred), 3 * Math.min(Math.abs(before), Math.abs(after)))
  }
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  return values[i].map(
    (v1, d) => h00 * v1 + h10 * dt * slope(i, d) + h01 * values[i + 1][d] + h11 * dt * slope(i + 1, d)
  )
}

/** The index of the key at or before `t`, so `t` falls between it and the next one. */
function segment(keys: AnimKey[], t: number): number {
  let lo = 0
  let hi = keys.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keys[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function sampleTrack(track: AnimTrack, t: number): AnimState | null {
  const keys = track.keys
  if (!keys.length) return null
  const one = (k: AnimKey): AnimState => ({
    position: [...k.position],
    rotation: [...k.rotation],
    quaternion: quaternionOf(k.rotation),
    pose: k.pose && fullPose(k.pose),
    parts: k.parts && structuredClone(k.parts)
  })
  if (keys.length === 1 || t <= keys[0].t) return one(keys[0])
  if (t >= keys[keys.length - 1].t) return one(keys[keys.length - 1])
  const i = segment(keys, t)
  const u = (t - keys[i].t) / Math.max(1e-6, keys[i + 1].t - keys[i].t)
  // Only the four keys around the segment shape it.
  const lo = Math.max(0, i - 1)
  const near = keys.slice(lo, i + 3)
  const at = i - lo
  const times = near.map((k) => k.t)
  // A window that starts at the track's first key or ends at its last gives those keys zero slope, as it should.
  const ease = (vals: number[][]): number[] => hermite(times, vals, at, u)

  const position = hermite(
    times,
    near.map((k) => k.position),
    at,
    u,
    [1]
  ) as Vec3

  // Rotations go through quaternions (no flips at ±180°), kept on one side of the sphere so they take the short way.
  const qs = near.map((k) => quaternionOf(k.rotation))
  for (let j = 0; j < qs.length; j++)
    if (j !== at && qs[j].dot(qs[at]) < 0) qs[j].set(-qs[j].x, -qs[j].y, -qs[j].z, -qs[j].w)
  const qv = ease(qs.map((q) => [q.x, q.y, q.z, q.w]))
  const quaternion = new THREE.Quaternion(qv[0], qv[1], qv[2], qv[3]).normalize()

  let pose: Pose | undefined
  if (near.some((k) => k.pose)) {
    const poses = near.map((k) => fullPose(k.pose ?? keys.find((x) => x.pose)?.pose))
    const flat = ease(poses.map((p) => PART_NAMES.flatMap((name) => p[name])))
    pose = Object.fromEntries(
      PART_NAMES.map((name, j) => [name, [flat[j * 3], flat[j * 3 + 1], flat[j * 3 + 2]]])
    ) as Pose
  }

  let parts: Record<string, Vec3> | undefined
  if (near.some((k) => k.parts)) {
    const names = [...new Set(near.flatMap((k) => Object.keys(k.parts ?? {})))]
    const flat = ease(near.map((k) => names.flatMap((name) => k.parts?.[name] ?? [0, 0, 0])))
    parts = Object.fromEntries(names.map((name, j) => [name, [flat[j * 3], flat[j * 3 + 1], flat[j * 3 + 2]] as Vec3]))
  }

  return { position, rotation: rotationOf(quaternion), quaternion, pose, parts }
}

// ------------------------------------------------------------------ editing

/** Keys closer together than this are the same key. */
export const KEY_EPSILON = 1 / 120

/** Adds a key, replacing one already at (about) the same time; keeps the list sorted. */
export function putKey(keys: AnimKey[], key: AnimKey): AnimKey[] {
  const rest = keys.filter((k) => Math.abs(k.t - key.t) >= KEY_EPSILON)
  return [...rest, key].sort((a, b) => a.t - b.t)
}

/** The key at (about) time `t`, if there is one. */
export const keyAt = (keys: AnimKey[], t: number): number => keys.findIndex((k) => Math.abs(k.t - t) < KEY_EPSILON)

// ------------------------------------------------------------------ paths

/** A smooth curve through the points (centripetal Catmull-Rom, so it never loops or overshoots at sharp turns). */
export class PathCurve {
  readonly samples: THREE.Vector3[] = []
  readonly lengths: number[] = []

  constructor(points: Vec3[], perSegment = 24) {
    const pts = points.map((p) => new THREE.Vector3(...p))
    if (pts.length === 1) pts.push(pts[0].clone())
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const n = Math.max(2, (pts.length - 1) * perSegment)
    let total = 0
    for (let i = 0; i <= n; i++) {
      const p = curve.getPoint(i / n)
      if (i) total += p.distanceTo(this.samples[i - 1])
      this.samples.push(p)
      this.lengths.push(total)
    }
  }

  get length(): number {
    return this.lengths[this.lengths.length - 1]
  }

  private find(s: number): [number, number] {
    const L = this.lengths
    if (s <= 0) return [0, 0]
    if (s >= this.length) return [L.length - 2, 1]
    let lo = 0
    let hi = L.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (L[mid] <= s) lo = mid
      else hi = mid
    }
    return [lo, (s - L[lo]) / Math.max(1e-9, L[hi] - L[lo])]
  }

  pointAt(s: number): THREE.Vector3 {
    const [i, f] = this.find(s)
    return this.samples[i].clone().lerp(this.samples[i + 1], f)
  }

  /** Heading in the ground plane at distance `s`, as a yaw in radians (0 faces +Z, like a placed player). */
  yawAt(s: number): number | null {
    const a = this.pointAt(Math.max(0, s - 0.15))
    const b = this.pointAt(Math.min(this.length, s + 0.15))
    const dx = b.x - a.x
    const dz = b.z - a.z
    return Math.hypot(dx, dz) < 1e-6 ? null : Math.atan2(dx, dz)
  }
}

// ------------------------------------------------------------------ gaits

export interface GaitDef {
  label: string
  /** Blocks per second at 1× speed. */
  speed: number
  /** Thigh swing either way, degrees. */
  leg: number
  /**
   * Knee bend (degrees) at the four quarters of a step cycle, right leg: passing while swinging forward, planted in
   * front, passing under the body, pushing off behind. The left leg is half a cycle later.
   */
  knee: [number, number, number, number]
  arm: number
  /** Elbow bend: always, and extra as the arm swings forward. */
  elbow: number
  elbowSwing: number
  /** Forward lean at full speed, degrees. */
  lean: number
  /** Airborne lift (blocks) between steps: running has a flight phase, walking never leaves the ground. */
  hop: number
  /** How much further each step goes than the feet alone would carry it (flight phases make strides longer). */
  reach: number
  /** Seconds to get up to speed, and to stop. */
  accel: number
  /** How quickly the character turns toward where the path goes (higher is snappier). */
  turn: number
  /** Not on the ground (swimming, climbing): the feet are not pressed down to it. */
  free?: boolean
  /** The whole cycle as poses, for gaits that aren't a walk's swing of legs and arms (full stride). */
  cycle?: (phase: number) => Partial<Pose>
}

export const GAITS: Record<Gait, GaitDef> = {
  sneak: {
    label: 'Sneak',
    speed: 1.3,
    leg: 22,
    knee: [30, 4, 6, 12],
    arm: 10,
    elbow: 10,
    elbowSwing: 6,
    lean: 10,
    hop: 0,
    reach: 1,
    accel: 0.4,
    turn: 8
  },
  walk: {
    label: 'Walk',
    speed: 2.6,
    leg: 32,
    knee: [38, 4, 6, 16],
    arm: 26,
    elbow: 8,
    elbowSwing: 14,
    lean: 2,
    hop: 0,
    reach: 1,
    accel: 0.45,
    turn: 9
  },
  run: {
    label: 'Run',
    speed: 5,
    leg: 48,
    knee: [80, 14, 22, 40],
    arm: 48,
    elbow: 62,
    elbowSwing: 22,
    lean: 8,
    hop: 0.07,
    reach: 1.4,
    accel: 0.6,
    turn: 7
  },
  swim: {
    label: 'Swim',
    speed: 1.9,
    leg: 70,
    knee: [10, 10, 10, 10],
    arm: 0,
    elbow: 0,
    elbowSwing: 0,
    lean: 72,
    hop: 0,
    reach: 1,
    accel: 0.7,
    turn: 5,
    free: true,
    // A crawl stroke: arms reach forward overhead and pull back to the sides, legs flutter.
    cycle: (phase) => ({
      rightArm: [-95 + 95 * Math.cos(phase), 0, -4],
      leftArm: [-95 - 95 * Math.cos(phase), 0, 4],
      rightForearm: [-12, 0, 0],
      leftForearm: [-12, 0, 0],
      rightLeg: [16 * Math.sin(2 * phase), 0, 0],
      leftLeg: [-16 * Math.sin(2 * phase), 0, 0],
      rightShin: [12, 0, 0],
      leftShin: [12, 0, 0],
      head: [-50, 0, 0],
      body: [0, 0, 0]
    })
  },
  climb: {
    label: 'Climb',
    speed: 2.2,
    leg: 25,
    knee: [10, 10, 10, 10],
    arm: 0,
    elbow: 0,
    elbowSwing: 0,
    lean: 0,
    hop: 0,
    reach: 1,
    accel: 0.35,
    turn: 8,
    free: true,
    // Hand over hand, a knee up on the other side: facing the rungs.
    cycle: (phase) => {
      const s = Math.sin(phase)
      return {
        rightArm: [-150 + 35 * s, 0, -8],
        leftArm: [-150 - 35 * s, 0, 8],
        rightForearm: [-(25 + 15 * s), 0, 0],
        leftForearm: [-(25 - 15 * s), 0, 0],
        rightLeg: [-35 - 25 * s, 0, 0],
        leftLeg: [-35 + 25 * s, 0, 0],
        rightShin: [55 + 25 * s, 0, 0],
        leftShin: [55 - 25 * s, 0, 0],
        head: [-25, 0, 0],
        body: [4, 0, 0]
      }
    }
  },
  sprint: {
    label: 'Sprint',
    speed: 7.5,
    leg: 62,
    knee: [105, 20, 28, 45],
    arm: 68,
    elbow: 80,
    elbowSwing: 20,
    lean: 16,
    hop: 0.1,
    reach: 1.6,
    accel: 0.85,
    turn: 6
  }
}

/** Upper and lower leg length of a player at scale 1, in blocks. */
const THIGH = 6 * PLAYER_PIXEL
const SHIN = 6 * PLAYER_PIXEL

/** Blocks travelled per full step cycle (two steps), so planted feet don't slide. */
export function strideOf(g: GaitDef, scale = 1): number {
  return 4 * (THIGH + SHIN) * Math.sin(g.leg * D2R) * g.reach * scale
}

/** A smooth periodic curve through four values at the quarters of the cycle. */
function quarters(v: [number, number, number, number], phase: number): number {
  const c0 = (v[0] + v[1] + v[2] + v[3]) / 4
  const c1 = (v[0] - v[2]) / 2
  const s1 = (v[1] - v[3]) / 2
  const c2 = (v[0] - v[1] + v[2] - v[3]) / 4
  return c0 + c1 * Math.cos(phase) + s1 * Math.sin(phase) + c2 * Math.cos(2 * phase)
}

/**
 * A player's pose at a point in the step cycle (`phase` in radians; 0 is the right leg passing under the body on its
 * way forward), blended from `base` by `amount` (0 standing as posed … 1 full stride).
 */
export function gaitPose(g: GaitDef, phase: number, amount: number, base: Pose): Pose {
  const s = Math.sin(phase)
  const lean = g.lean * amount
  const cycle: Partial<Pose> = g.cycle?.(phase) ?? {
    // Negative X swings a limb forward.
    rightLeg: [-g.leg * s, 0, 0],
    leftLeg: [g.leg * s, 0, 0],
    rightShin: [quarters(g.knee, phase), 0, 0],
    leftShin: [quarters(g.knee, phase + Math.PI), 0, 0],
    rightArm: [g.arm * s, 0, -3],
    leftArm: [-g.arm * s, 0, 3],
    rightForearm: [-(g.elbow + (g.elbowSwing * (1 - s)) / 2), 0, 0],
    leftForearm: [-(g.elbow + (g.elbowSwing * (1 + s)) / 2), 0, 0],
    // Eyes stay on where they're going while the body leans.
    head: [-lean * 0.7, 0, 0],
    body: [0, 0, 0]
  }
  const out = fullPose(base)
  for (const name of PART_NAMES) {
    const c = cycle[name]
    if (!c) continue
    out[name] = out[name].map((v, i) => v + (c[i] - v) * amount) as Vec3
  }
  return out
}

/** How far the body must drop for the lower foot to touch the ground (blocks, at scale 1). */
export function footDrop(pose: Pose): number {
  const drop = (thigh: number, knee: number): number =>
    THIGH * Math.cos(thigh * D2R) + SHIN * Math.cos((thigh + knee) * D2R)
  const lowest = Math.max(drop(pose.rightLeg[0], pose.rightShin[0]), drop(pose.leftLeg[0], pose.leftShin[0]))
  return THIGH + SHIN - lowest
}

/** A mob's leg or arm, and when in the step cycle it swings. */
export interface MobLimb {
  path: string
  /** Radians added to the cycle's phase. */
  offset: number
  /** Arms swing less than legs. */
  scale: number
}

/**
 * Picks out a mob's legs (and arms, for zombies and the like) by their part names, and times them the way the
 * game does: hind legs opposite each other, each front leg opposite the hind leg on its side, arms opposite legs.
 */
export function mobLimbs(paths: string[]): MobLimb[] {
  const out: MobLimb[] = []
  for (const path of paths) {
    const name = path.split('/').pop() ?? ''
    const right = name.includes('right')
    const left = name.includes('left')
    if (!right && !left) continue
    const side = right ? 0 : Math.PI
    if (name.includes('leg')) {
      const front = name.includes('front') && !name.includes('middle_front')
      const middle = name.includes('middle')
      out.push({ path, offset: side + (front ? Math.PI : 0) + (middle ? Math.PI / 2 : 0), scale: 1 })
    } else if (name.endsWith('arm')) out.push({ path, offset: side + Math.PI, scale: 0.7 })
  }
  return out
}

/** The part names of a mob built like a person (zombie, skeleton, piglin…), by the joint of a player they stand for. */
export type Humanoid = Partial<Record<'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg', string>>

const HUMANOID_NAMES: Record<keyof Humanoid, string> = {
  head: 'head',
  body: 'body',
  rightArm: 'right_arm',
  leftArm: 'left_arm',
  rightLeg: 'right_leg',
  leftLeg: 'left_leg'
}

/** Finds a person's parts among a mob's part paths; null for a mob that isn't built like one (no head, body and legs). */
export function humanoidOf(paths: string[]): Humanoid | null {
  const out: Humanoid = {}
  for (const role of Object.keys(HUMANOID_NAMES) as (keyof Humanoid)[]) {
    const hit = paths.find((p) => p.split('/').pop() === HUMANOID_NAMES[role])
    if (hit) out[role] = hit
  }
  return out.head && out.body && out.rightLeg && out.leftLeg ? out : null
}

/**
 * A player's pose as extra rotations for a mob's parts. A mob's parts turn in the game's model space (Z, then Y, then
 * X, with Y pointing down and Z backwards), so each joint's rotation is carried over by flipping the model's axes: the
 * same turn seen from the other side. An elbow can't bend on these, so the arm takes part of the forearm's bend.
 */
export function partsFromPose(pose: Pose, h: Humanoid, base: Record<string, Vec3> = {}): Record<string, Vec3> {
  const out: Record<string, Vec3> = { ...base }
  const joint = (role: keyof Humanoid, extra = 0): void => {
    const path = h[role]
    if (!path) return
    const a = pose[role]
    const e = new THREE.Euler(a[0] * D2R + extra * D2R, a[1] * D2R, a[2] * D2R, 'XYZ')
    const q = new THREE.Quaternion().setFromEuler(e)
    q.set(q.x, -q.y, -q.z, q.w)
    const m = new THREE.Euler().setFromQuaternion(q, 'ZYX')
    const b = out[path] ?? [0, 0, 0]
    out[path] = [b[0] + m.x / D2R, b[1] + m.y / D2R, b[2] + m.z / D2R]
  }
  joint('head')
  joint('body')
  joint('rightArm', pose.rightForearm[0] * 0.55)
  joint('leftArm', pose.leftForearm[0] * 0.55)
  joint('rightLeg')
  joint('leftLeg')
  return out
}

export interface WalkSubject {
  kind: 'player' | 'mob'
  scale: number
  /** The object's rotation before it sets off (degrees); its yaw is where it faces at the start. */
  rotation: Vec3
  /** Players: the pose it starts and ends in. */
  pose?: Pose
  /** Mobs: its own part rotations, and which parts are legs. */
  parts?: Record<string, Vec3>
  limbs?: MobLimb[]
  /** Mobs built like a person: where their parts are, so a player's actions play on them. */
  humanoid?: Humanoid | null
}

const DT = 1 / 240

/** Seconds a walk along `path` takes for this subject (start to stop). */
export function walkDuration(path: AnimPath, scale = 1): number {
  return walkKeys(path, { kind: 'mob', scale, rotation: [0, 0, 0] }).at(-1)!.t - path.start
}

/** Which way a rotation (degrees) faces in the ground plane, in radians (0 faces +Z). */
export function yawOfRotation(rotation: Vec3): number {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternionOf(rotation))
  return Math.hypot(f.x, f.z) < 1e-6 ? rotation[1] * D2R : Math.atan2(f.x, f.z)
}

export interface LocomotionResult {
  keys: AnimKey[]
  /** Where in the step cycle it ended (radians) and which way it faces, for the block that follows. */
  phase: number
  yaw: number
}

/**
 * Keys for a character walking, running or sprinting along a path: it speeds up, follows the curve while turning
 * smoothly (leaning into turns), swings its limbs in step with the distance covered so feet don't slide, bobs, and
 * slows to a stop in the pose it started in. Keys fall on every quarter step (contact, passing…), which is enough
 * for the smooth playback between them to reproduce the cycle, and are easy to adjust by hand afterwards.
 */
export function walkKeys(path: AnimPath, who: WalkSubject): AnimKey[] {
  return locomotion(path, who).keys
}

export function locomotion(path: AnimPath, who: WalkSubject): LocomotionResult {
  const g = GAITS[path.gait]
  const curve = new PathCurve(path.points)
  const L = curve.length
  const scale = who.scale || 1
  const easeIn = path.easeIn ?? true
  const easeOut = path.easeOut ?? true
  let vmax = g.speed * Math.max(0.05, path.speed) * scale
  let ta = g.accel
  let total: number
  if (path.duration) {
    // The block sets how long it takes: the speed follows from the distance.
    total = path.duration
    ta = Math.min(g.accel, total / 3)
    vmax = Math.max(1e-3, L / (total - ta * 0.5 * ((easeIn ? 1 : 0) + (easeOut ? 1 : 0))))
  } else {
    // Too short to get up to speed: the same acceleration, a lower peak and shorter ramps.
    if (L < vmax * ta) {
      const accel = vmax / ta
      ta = Math.max(1e-3, Math.sqrt(L / accel))
      vmax = Math.max(1e-3, accel * ta)
    }
    const cruise = Math.max(0, (L - vmax * ta) / vmax)
    total = ta * 2 + cruise
  }
  const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  const speedAt = (t: number): number =>
    vmax * Math.min(easeIn ? smooth(t / ta) : 1, easeOut ? smooth((total - t) / ta) : 1)
  const stride = strideOf(g, scale)
  const s0 = ((path.phase ?? 0) * stride) / (2 * Math.PI)

  let yaw = yawOfRotation(who.rotation)
  let yawRate = 0
  let s = 0
  let lastQuarter = Math.floor((4 * s0) / stride)
  let lastKeyT = -1
  const keys: AnimKey[] = []
  const basePose = who.pose ? fullPose(who.pose) : undefined

  const emit = (t: number): void => {
    const v = speedAt(t)
    const amount = Math.min(1, v / (0.6 * g.speed * scale))
    const phase = (2 * Math.PI * (s + s0)) / stride
    const p = curve.pointAt(s)
    // Lean forward with speed, and into turns like anything moving fast round a bend.
    const pitch = g.lean * amount * D2R
    const roll = THREE.MathUtils.clamp(-Math.atan((v * yawRate) / 30), -0.3, 0.3)
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll))
    const key: AnimKey = { t: path.start + t, position: [p.x, p.y, p.z], rotation: rotationOf(q) }
    if (who.kind === 'player') {
      const pose = gaitPose(g, phase, amount, basePose ?? fullPose(undefined))
      key.pose = pose
      const lift = g.hop * amount * Math.sin(phase) ** 2
      key.position[1] += (lift - (g.free ? 0 : footDrop(pose))) * scale
    } else {
      const parts: Record<string, Vec3> = structuredClone(who.parts ?? {})
      const swing = g.leg * 1.2 * amount
      for (const limb of who.limbs ?? []) {
        const base = parts[limb.path] ?? [0, 0, 0]
        parts[limb.path] = [base[0] + swing * limb.scale * Math.cos(phase + limb.offset), base[1], base[2]]
      }
      key.parts = parts
    }
    keys.push(key)
    lastKeyT = t
  }

  emit(0)
  let t = 0
  while (t < total) {
    const next = Math.min(total, t + DT)
    const v = speedAt((t + next) / 2)
    s = Math.min(L, s + v * (next - t))
    // Turn toward the path's heading with a critically damped spring: no snapping, no wobble.
    const target = path.heading ?? curve.yawAt(s)
    if (target !== null) {
      let want = target
      while (want - yaw > Math.PI) want -= 2 * Math.PI
      while (want - yaw < -Math.PI) want += 2 * Math.PI
      const w = g.turn
      yawRate += (w * w * (want - yaw) - 2 * w * yawRate) * (next - t)
      yaw += yawRate * (next - t)
    }
    t = next
    const quarter = Math.floor((4 * (s + s0)) / stride)
    // A key on every quarter step, and never more than a fifth of a second apart (slow starts and stops).
    if (t < total && (quarter !== lastQuarter || t - lastKeyT >= 0.2)) {
      lastQuarter = quarter
      emit(t)
    }
  }
  yawRate = 0
  s = L
  emit(total)
  return { keys, phase: (2 * Math.PI * (L + s0)) / stride, yaw }
}

// ------------------------------------------------------------------ blocks

export interface ClipDef {
  label: string
  /** Moves along a path (as opposed to acting where it stands). */
  moves: boolean
  /** How long a new block lasts, seconds. */
  duration: number
  /** Players only: poses have no meaning for a mob's parts. */
  playersOnly?: boolean
  hint: string
  /** The ways an action can play; the first is the default. Moving blocks have none. */
  modes: ClipMode[]
  /** Seconds one go of the action takes, when it loops or holds. */
  period: number
}

const move = (label: string, duration: number, hint: string): ClipDef => ({
  label,
  moves: true,
  duration,
  hint,
  modes: [],
  period: 1
})
const act = (
  label: string,
  duration: number,
  modes: ClipMode[],
  period: number,
  hint: string,
  playersOnly = true
): ClipDef => ({ label, moves: false, duration, hint, modes, period, playersOnly })

export const CLIPS: Record<ClipType, ClipDef> = {
  walk: move('Walk', 3, 'Walks along the path, and breaks into a run if its length asks for more speed'),
  run: move('Run', 2.5, 'Runs along the path'),
  sprint: move('Sprint', 2, 'Sprints along the path'),
  sneak: move('Sneak', 3, 'Creeps along the path, low and slow'),
  swim: move('Swim', 3, 'Swims along the path, face down, arms over arm'),
  climb: move('Climb', 3, 'Climbs a ladder or vine along the path (go up for a ladder)'),
  leap: move('Leap', 1, 'Springs over a gap to the point on the path, in an arc'),
  idle: act('Idle', 2, ['loop'], 6, 'Stands and breathes, looks about a little', false),
  point: act('Point', 2, ['hold', 'once'], 1, 'Raises an arm and points ahead'),
  jump: act('Jump', 1.2, ['once', 'loop'], 1.2, 'Crouches, jumps and lands', false),
  shrug: act('Shrug', 1.8, ['once', 'loop'], 1.8, 'Palms up, shoulders and head to one side'),
  wave: act('Wave', 2, ['loop', 'once'], 1, 'Waves with the left arm'),
  mine: act('Mine', 2, ['loop', 'once'], 0.8, 'Swings a tool at a block, over and over'),
  chop: act('Chop', 2.2, ['loop', 'once'], 1.1, 'Raises both arms and brings them down'),
  eat: act('Eat', 2, ['loop', 'once'], 1.5, 'Brings a hand to the mouth and chews'),
  nod: act('Nod', 1.2, ['once', 'loop'], 1.2, 'Nods yes'),
  shake: act('Shake head', 1.2, ['once', 'loop'], 1.2, 'Shakes the head no'),
  laugh: act('Laugh', 2, ['loop', 'once'], 1, 'Head back, shoulders shaking'),
  panic: act('Panic', 2, ['loop', 'once'], 0.7, 'Flails both arms and whips the head about'),
  cower: act('Cower', 2.5, ['hold', 'loop'], 1.2, 'Ducks and covers the head, with a shiver when looped'),
  facepalm: act('Facepalm', 2, ['hold', 'once'], 1, 'Hand to the face, head down'),
  bow: act('Bow', 2, ['hold', 'once'], 1.2, 'Bends at the waist, hand across the chest'),
  sit: act('Sit', 3, ['hold', 'once'], 0.8, 'Sits down on the spot'),
  reach: act(
    'Reach',
    2,
    ['hold', 'once'],
    0.7,
    'Puts a hand on a spot you place in the scene, as a chest, a block or a tool'
  ),
  hit: act('Hit', 0.9, ['once', 'loop'], 0.9, 'Flinches as if struck'),
  punch: act('Punch', 1.2, ['once', 'loop'], 0.6, 'Winds up and throws a right jab, guard up'),
  slash: act('Slash', 1.4, ['once', 'loop'], 0.9, 'Raises the right arm and cuts down across, as a sword swing'),
  block: act('Block', 2, ['hold', 'once'], 0.5, 'Raises a guard, shield arm forward'),
  cheer: act('Cheer', 2.5, ['loop', 'once'], 0.8, 'Both arms up, bouncing'),
  clap: act('Clap', 2, ['loop', 'once'], 0.5, 'Claps the hands in front'),
  think: act('Think', 2.5, ['hold', 'once'], 1, 'Hand to the chin, head tilted'),
  fall: act('Fall', 3, ['once'], 3, 'Flails, drops flat on the back and lies there, then gets up'),
  sleep: act('Sleep', 4, ['once'], 4, 'Lies down on the back, breathing slowly, then wakes')
}
/** Blocks that only use the head, body and arms, and so can be dropped on the upper-body row to play over a walk. */
const UPPER: ClipType[] = [
  'idle',
  'point',
  'wave',
  'shrug',
  'nod',
  'shake',
  'laugh',
  'panic',
  'cower',
  'facepalm',
  'bow',
  'mine',
  'chop',
  'eat',
  'reach',
  'hit',
  'punch',
  'slash',
  'block',
  'cheer',
  'clap',
  'think'
]
export const canLayer = (type: ClipType): boolean => UPPER.includes(type)
export const laneOf = (c: Pick<Clip, 'layer'>): 'base' | 'upper' => c.layer ?? 'base'
export const CLIP_ORDER: ClipType[] = [
  'walk',
  'run',
  'sprint',
  'sneak',
  'swim',
  'climb',
  'leap',
  'idle',
  'jump',
  'point',
  'wave',
  'shrug',
  'nod',
  'shake',
  'laugh',
  'panic',
  'cower',
  'facepalm',
  'bow',
  'sit',
  'mine',
  'chop',
  'eat',
  'reach',
  'hit',
  'punch',
  'slash',
  'block',
  'cheer',
  'clap',
  'think',
  'fall',
  'sleep'
]
/** How a block plays (what it was set to, else its type's first mode). */
export const modeOf = (c: Pick<Clip, 'type' | 'mode'>): ClipMode | null => {
  const modes = CLIPS[c.type].modes
  return modes.length ? (c.mode && modes.includes(c.mode) ? c.mode : modes[0]) : null
}
export const isMoving = (c: Pick<Clip, 'type'>): boolean => CLIPS[c.type].moves

export const MIN_CLIP = 0.5

/** Blocks sorted by start. */
export interface Span {
  id: string
  start: number
  duration: number
}

export const sortedClips = <T extends Span>(clips: T[]): T[] => [...clips].sort((a, b) => a.start - b.start)

/**
 * Where a block (wanting to start at `start` and last `duration`) fits among the others without overlapping them:
 * the free gap nearest to where it was dropped, shortened if the gap is smaller than the block. Null when no gap
 * is long enough.
 */
export function placeClip(
  others: Span[],
  want: { start: number; duration: number },
  min = MIN_CLIP
): { start: number; duration: number } | null {
  const gaps: [number, number][] = []
  let at = 0
  for (const c of sortedClips(others)) {
    if (c.start > at) gaps.push([at, c.start])
    at = Math.max(at, c.start + c.duration)
  }
  gaps.push([at, Infinity])
  let best: { start: number; duration: number; cost: number } | null = null
  for (const [a, b] of gaps) {
    const room = b - a
    if (room < min) continue
    const duration = Math.min(want.duration, room)
    const start = Math.min(Math.max(want.start, a), b - duration)
    const cost = Math.abs(start - want.start) + (duration < want.duration ? 1 : 0)
    if (!best || cost < best.cost) best = { start, duration, cost }
  }
  return best && { start: best.start, duration: best.duration }
}

/** Drags one edge of a block to time `t`, stopping at its neighbours and keeping it at least `min` long. */
export function resizeClip<T extends Span>(
  clips: T[],
  id: string,
  edge: 'start' | 'end',
  t: number,
  min = MIN_CLIP
): T[] {
  const sorted = sortedClips(clips)
  const i = sorted.findIndex((c) => c.id === id)
  if (i < 0) return clips
  const c = sorted[i]
  const end = c.start + c.duration
  if (edge === 'start') {
    const lo = i > 0 ? sorted[i - 1].start + sorted[i - 1].duration : 0
    const start = Math.min(Math.max(t, lo), end - min)
    return clips.map((x) => (x.id === id ? { ...x, start, duration: end - start } : x))
  }
  const hi = i < sorted.length - 1 ? sorted[i + 1].start : Infinity
  const newEnd = Math.max(Math.min(t, hi), c.start + min)
  return clips.map((x) => (x.id === id ? { ...x, duration: newEnd - c.start } : x))
}

// ------------------------------------------------------------------ actions

const smoothstep = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
/** Ease in that runs a few percent past 1 before settling on it. */
const backOut = (x: number): number => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const c = 1.1
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return Object.fromEntries(PART_NAMES.map((n) => [n, a[n].map((v, i) => v + (b[n][i] - v) * t) as Vec3])) as Pose
}

/** A pose change layered over `rest`: the named joints are set to these angles. */
const over = (rest: Pose, set: Partial<Pose>): Pose => {
  const out = fullPose(rest)
  for (const n of PART_NAMES) if (set[n]) out[n] = [...(set[n] as Vec3)]
  return out
}

/** What a player's pose is `t` seconds into an action that lasts `dur`, easing in and out of `rest`. */
function actionPose(
  type: ClipType,
  t: number,
  dur: number,
  rest: Pose,
  u = 0,
  mode: ClipMode = 'once',
  join?: { from?: Pose; exit?: boolean }
): Pose {
  const ease = Math.min(0.35, dur / 3)
  // Settles in with a little overshoot rather than gliding to a stop, and eases out smoothly. A block that runs
  // straight into another action doesn't drop back to rest first: it carries on into the next one's pose.
  const e =
    (join?.from ? smoothstep(t / ease) : backOut(t / ease)) * (join?.exit === false ? 1 : smoothstep((dur - t) / ease))
  const a = (2 * Math.PI * t) / 1
  const TAU = 2 * Math.PI
  // Poses reached and left again (held ones stop at the top): 0 at rest, 1 at the peak.
  const bell = Math.sin(Math.PI * Math.min(1, u))
  // A raise and a drop for the swinging tools: up slowly, down fast, then a pause at the bottom.
  const swing = u < 0.65 ? smoothstep(u / 0.65) : 1 - smoothstep((u - 0.65) / 0.15)
  let target: Pose
  switch (type) {
    case 'hit': {
      // Thrown back, then catching itself.
      const k = Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - smoothstep((u - 0.6) / 0.4) * 0)
      target = over(rest, {
        head: [-22 * k, 8 * k, 0],
        body: [-14 * k, 0, 0],
        rightArm: [28 * k, 0, -22 * k],
        leftArm: [28 * k, 0, 22 * k]
      })
      break
    }
    case 'punch': {
      // Draws back, throws, and recovers.
      const j =
        u < 0.3
          ? -0.4 * smoothstep(u / 0.3)
          : u < 0.45
            ? -0.4 + 1.4 * smoothstep((u - 0.3) / 0.15)
            : 1 - smoothstep((u - 0.45) / 0.55)
      target = over(rest, {
        head: [-4, 0, 0],
        body: [4, 18 * j, 0],
        rightArm: [-30 - 60 * j, 0, -6],
        rightForearm: [-95 + 85 * Math.max(0, j), 0, 0],
        leftArm: [-55, 0, 14],
        leftForearm: [-85, 0, 0]
      })
      break
    }
    case 'slash': {
      target = over(rest, {
        head: [4 * (1 - swing), 0, 0],
        body: [8 * (1 - swing) - 2, -20 * (1 - swing) + 12 * swing, 0],
        rightArm: [-40 - 125 * (1 - swing) + 100 * swing, 0, -12 + 26 * swing],
        rightForearm: [-25, 0, 0],
        leftArm: [-8, 0, 12]
      })
      break
    }
    case 'block':
      target = over(rest, {
        head: [-4 * bell, 0, 0],
        body: [6 * bell, 0, 0],
        rightArm: [-70 * bell, 10 * bell, -6 * bell],
        rightForearm: [-85 * bell, 0, 0],
        leftArm: [-80 * bell, -10 * bell, 20 * bell],
        leftForearm: [-70 * bell, 0, 0]
      })
      break
    case 'cheer': {
      const hop = Math.sin(TAU * 2 * u)
      target = over(rest, {
        head: [-14, 0, 3 * hop],
        body: [-4, 0, 0],
        rightArm: [-158 - 10 * hop, 0, -16 + 6 * hop],
        leftArm: [-158 + 10 * hop, 0, 16 - 6 * hop],
        rightForearm: [-8, 0, 0],
        leftForearm: [-8, 0, 0]
      })
      break
    }
    case 'clap': {
      const c = 0.5 + 0.5 * Math.cos(TAU * 2 * u)
      target = over(rest, {
        head: [6, 0, 0],
        rightArm: [-62, 0, -2 - 16 * c],
        leftArm: [-62, 0, 2 + 16 * c],
        rightForearm: [-45, 0, 0],
        leftForearm: [-45, 0, 0]
      })
      break
    }
    case 'think':
      target = over(rest, {
        head: [10 * bell, 14 * bell, 6 * bell],
        rightArm: [-60 * bell, 0, 0],
        rightForearm: [-125 * bell, 0, 0],
        leftArm: [-35 * bell, 0, 8 * bell],
        leftForearm: [-75 * bell, 0, 0]
      })
      break
    case 'nod':
      target = over(rest, { head: [12 * (1 - Math.cos(2 * TAU * u)), 0, 0] })
      break
    case 'shake':
      target = over(rest, { head: [0, 26 * Math.sin(3 * TAU * u), 0] })
      break
    case 'laugh': {
      const k = Math.sin(5 * TAU * u)
      target = over(rest, {
        head: [-16 + 3 * k, 0, 4 * Math.sin(TAU * u)],
        body: [-7 - 2 * k, 0, 0],
        rightArm: [-35, 0, -20],
        leftArm: [-35, 0, 20]
      })
      break
    }
    case 'panic':
      target = over(rest, {
        head: [-6, 26 * Math.sin(3 * TAU * u), 0],
        rightArm: [-130 + 55 * Math.sin(2 * TAU * u), 0, -35 + 20 * Math.sin(2 * TAU * u + 1)],
        leftArm: [-130 - 55 * Math.sin(2 * TAU * u), 0, 35 - 20 * Math.sin(2 * TAU * u + 1)],
        rightForearm: [-30, 0, 0],
        leftForearm: [-30, 0, 0]
      })
      break
    case 'cower': {
      // Looped, it holds the ducked pose and shivers.
      const b = mode === 'loop' ? 1 : bell
      const shiver = mode === 'loop' ? Math.sin(8 * TAU * u) : 0
      target = over(rest, {
        head: [28 * b + 2 * shiver, 0, 0],
        body: [38 * b, 0, 1.5 * shiver],
        rightArm: [-150 * b, 0, -15 * b],
        leftArm: [-150 * b, 0, 15 * b],
        rightForearm: [-40 * b, 0, 0],
        leftForearm: [-40 * b, 0, 0]
      })
      break
    }
    case 'facepalm':
      target = over(rest, {
        head: [20 * bell, 0, 0],
        rightArm: [-100 * bell, 0, 0],
        rightForearm: [-120 * bell, 0, 0]
      })
      break
    case 'bow':
      target = over(rest, {
        body: [42 * bell, 0, 0],
        head: [12 * bell, 0, 0],
        rightArm: [-60 * bell, 20 * bell, 0],
        rightForearm: [-90 * bell, 0, 0]
      })
      break
    case 'sit':
      target = over(rest, {
        rightLeg: [-90 * bell, 0, 0],
        leftLeg: [-90 * bell, 0, 0],
        rightArm: [-25 * bell, 0, 0],
        leftArm: [-25 * bell, 0, 0]
      })
      break
    case 'mine':
      target = over(rest, {
        head: [8, 0, 0],
        body: [6 * (1 - swing), 0, 0],
        rightArm: [-35 - 80 * swing, 0, 0],
        rightForearm: [-10, 0, 0],
        leftArm: [-20, 0, 6]
      })
      break
    case 'chop':
      target = over(rest, {
        head: [6 * (1 - swing), 0, 0],
        body: [12 * (1 - swing) - 4, 0, 0],
        rightArm: [-30 - 140 * swing, 0, -6],
        leftArm: [-30 - 140 * swing, 0, 6],
        rightForearm: [-20, 0, 0],
        leftForearm: [-20, 0, 0]
      })
      break
    case 'eat': {
      // Up to the mouth, chewing there, then back down.
      const b = u < 0.2 ? smoothstep(u / 0.2) : u > 0.8 ? 1 - smoothstep((u - 0.8) / 0.2) : 1
      target = over(rest, {
        head: [4 * b + 3 * b * Math.sin(4 * TAU * u), 0, 0],
        rightArm: [-30 - 50 * b, -10 * b, 0],
        rightForearm: [-100 * b, 0, 0]
      })
      break
    }
    case 'point':
      target = over(rest, {
        head: [-4, -20, 0],
        body: [0, -10, 0],
        rightArm: [-92, 14, 0],
        rightForearm: [-4, 0, 0],
        leftArm: [4, 0, 5]
      })
      break
    case 'shrug': {
      const lift = 0.5 + 0.5 * Math.sin(a * 1.4 - 1.2)
      target = over(rest, {
        head: [-3, 0, 7 + 3 * lift],
        rightArm: [-22 - 6 * lift, -10, -34 - 6 * lift],
        rightForearm: [-75, 0, 0],
        leftArm: [-22 - 6 * lift, 10, 34 + 6 * lift],
        leftForearm: [-75, 0, 0]
      })
      break
    }
    case 'wave':
      target = over(rest, {
        head: [0, 10, 4],
        leftArm: [-160, 0, -22 + 6 * Math.sin(a * 2.2)],
        leftForearm: [-14 + 26 * Math.sin(a * 2.2 + 1), 0, 0]
      })
      break
    default: {
      // Idle: breathing and a slow look about, barely there.
      target = over(rest, {
        head: [2 * Math.sin(a / 3.4), 9 * Math.sin(a / 6.3), 0],
        body: [0.8 * Math.sin(a / 3.4 + 0.5), 0, 0],
        rightArm: [2.5 * Math.sin(a / 3.4 + 1), 0, -1.5 - 1.5 * Math.sin(a / 3.4)],
        leftArm: [-2.5 * Math.sin(a / 3.4 + 1), 0, 1.5 + 1.5 * Math.sin(a / 3.4)]
      })
    }
  }
  return lerpPose(join?.from && t < ease ? join.from : rest, target, e)
}

/** The jump: a crouch, a push, a tucked flight and a soft landing. Returns the pose and the lift in blocks. */
function jumpPose(u: number, rest: Pose, height: number): { pose: Pose; lift: number } {
  const crouch = Math.max(
    smoothstep(u / 0.2) * (1 - smoothstep((u - 0.2) / 0.1)),
    smoothstep((u - 0.8) / 0.1) * (1 - smoothstep((u - 0.9) / 0.1))
  )
  const w = Math.min(1, Math.max(0, (u - 0.3) / 0.5))
  const flying = u > 0.3 && u < 0.8
  const tuck = flying ? Math.sin(Math.PI * w) : 0
  // Arms swing back as it crouches, then up and out while it is in the air, then settle.
  const swing = smoothstep((u - 0.1) / 0.2) * (1 - smoothstep((u - 0.75) / 0.2))
  const armX = 35 * crouch * (1 - swing) + -150 * swing
  const armZ = 22 * swing
  const pose = over(rest, {
    head: [-6 * swing + 8 * crouch, 0, 0],
    rightArm: [armX, 0, -armZ],
    leftArm: [armX, 0, armZ],
    rightLeg: [-40 * crouch - 30 * tuck, 0, 0],
    leftLeg: [-40 * crouch - 18 * tuck, 0, 0],
    rightShin: [75 * crouch + 55 * tuck, 0, 0],
    leftShin: [75 * crouch + 45 * tuck, 0, 0]
  })
  return { pose, lift: flying ? height * 4 * w * (1 - w) : 0 }
}

/**
 * Lying down: how far back the body has tipped (degrees), the pose, and how much it is lifted so the back rests on the
 * ground. A fall drops fast with a flail and a bounce; sleep settles slowly and breathes.
 */
function lieState(type: 'fall' | 'sleep', t: number, dur: number, rest: Pose): { pose: Pose; tip: number } {
  const TAU = 2 * Math.PI
  if (type === 'fall') {
    const down = Math.min(1, t / 0.5)
    const drop = down * down
    const bounce = t > 0.5 && t < 0.9 ? Math.sin(((t - 0.5) / 0.4) * Math.PI) * 5 : 0
    const up = smoothstep((t - (dur - 0.7)) / 0.7)
    const lie = Math.max(0, drop * (1 - up))
    const raise = Math.min(1, t / 0.2) * (1 - smoothstep((t - 0.4) / 0.4))
    const flail = Math.max(0, 1 - t / 0.8) * Math.sin(TAU * 4 * t)
    return {
      tip: -90 * lie + bounce * (1 - up),
      pose: lerpPose(
        rest,
        over(rest, {
          head: [-10 * lie, 0, 0],
          rightArm: [-120 * raise + 25 * flail, 0, -30 - 40 * lie],
          leftArm: [-120 * raise - 25 * flail, 0, 30 + 40 * lie],
          rightLeg: [-18 * Math.min(1, t / 0.3) * (1 - up), 0, -5 * lie],
          leftLeg: [14 * Math.min(1, t / 0.3) * (1 - up), 0, 5 * lie]
        }),
        1
      )
    }
  }
  const down = smoothstep(t / 1) * (1 - smoothstep((t - (dur - 1)) / 1))
  const breath = Math.sin((TAU * t) / 3.2)
  return {
    tip: -90 * down,
    pose: lerpPose(
      rest,
      over(rest, {
        head: [0, 8 * down, 0],
        body: [1.2 * breath * down, 0, 0],
        rightArm: [-8 * down, 0, -8 * down + 1.5 * breath * down],
        leftArm: [-8 * down, 0, 8 * down - 1.5 * breath * down]
      }),
      1
    )
  }
}

/** The state a block leaves a character in, which the next block carries on from. */
interface Carry {
  position: Vec3
  rotation: Vec3
  yaw: number
  phase: number
  pose?: Pose
  parts?: Record<string, Vec3>
}

const ACTION_STEP = 1 / 24

/** How far through one go of the action a block is `t` seconds in (0…1; held ones stop half way, at the peak). */
function beatOf(clip: Clip, t: number): number {
  const mode = modeOf(clip)
  const period = CLIPS[clip.type].period
  // Whole cycles only, so the block ends where a go of the action ends: the period stretches a little to fit.
  if (mode === 'loop') return (t / (clip.duration / Math.max(1, Math.round(clip.duration / period)))) % 1
  if (mode === 'hold') return 0.5 * Math.min(1, t / period)
  return Math.min(1, t / clip.duration)
}

function actionKeys(
  clip: Clip,
  from: Carry,
  who: WalkSubject,
  rest: Pose | undefined,
  join: { before: boolean; after: boolean } = { before: false, after: false }
): AnimKey[] {
  const keys: AnimKey[] = []
  const mode = modeOf(clip) ?? 'once'
  const n = Math.max(1, Math.ceil(clip.duration / ACTION_STEP))
  const scale = who.scale || 1
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * clip.duration
    const key: AnimKey = {
      t: clip.start + t,
      position: [...from.position],
      rotation: [...from.rotation]
    }
    let lift = 0
    const person = who.kind === 'player' || !!who.humanoid
    const setPose = (k: AnimKey, p: Pose): void => {
      if (who.kind === 'player') k.pose = p
      else k.parts = partsFromPose(p, who.humanoid!, structuredClone(from.parts ?? who.parts ?? {}))
    }
    if (person) {
      let pose: Pose
      if (clip.type === 'fall' || clip.type === 'sleep') {
        const l = lieState(clip.type, t, clip.duration, rest ?? fullPose(undefined))
        pose = l.pose
        const q = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), from.yaw)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), l.tip * D2R))
        key.rotation = rotationOf(q)
        setPose(key, pose)
        // On its back the head and body hang below the feet's line: lift to match.
        key.position[1] += 0.22 * Math.sin(Math.abs(l.tip) * D2R) * scale
        keys.push(key)
        continue
      }
      if (clip.type === 'jump') {
        const j = jumpPose(beatOf(clip, t), rest ?? fullPose(undefined), 1.1)
        pose = j.pose
        lift = j.lift
      } else
        pose = actionPose(clip.type, t, clip.duration, rest ?? fullPose(undefined), beatOf(clip, t), mode, {
          from: join.before && from.pose ? from.pose : undefined,
          exit: !join.after
        })
      setPose(key, pose)
      // Feet stay on the ground while crouching, and leave it only in flight.
      key.position[1] += (lift ? lift : -footDrop(pose)) * scale
    } else {
      key.parts = structuredClone(from.parts ?? who.parts ?? {})
      if (clip.type === 'jump') {
        const u = beatOf(clip, t)
        const w = Math.min(1, Math.max(0, (u - 0.3) / 0.5))
        if (u > 0.3 && u < 0.8) key.position[1] += 1.1 * 4 * w * (1 - w) * scale
      }
    }
    keys.push(key)
  }
  return keys
}

// ------------------------------------------------------------------ compiling

const GAIT_OF: Partial<Record<ClipType, Gait>> = {
  sneak: 'sneak',
  walk: 'walk',
  run: 'run',
  sprint: 'sprint',
  swim: 'swim',
  climb: 'climb'
}

/** The gait that suits travelling at `speed` blocks a second: a walk gives way to a run, then a sprint. */
export const gaitForSpeed = (speed: number): Gait => (speed < 3.8 ? 'walk' : speed < 6.2 ? 'run' : 'sprint')
const TOUCHING = 0.05

/** A straight way ahead, for a block that has no path yet (a climb goes straight up). */
export function defaultPath(from: Vec3, yaw: number, length: number, type?: ClipType): Vec3[] {
  if (type === 'climb') return [[from[0], from[1] + length, from[2]]]
  return [[from[0] + Math.sin(yaw) * length, from[1], from[2] + Math.cos(yaw) * length]]
}

export interface CompiledClips {
  keys: AnimKey[]
  /** Where each moving block starts (the end of the one before it). */
  starts: Record<string, Vec3>
  /** The waypoints each moving block actually used (its own, or the default one it was given). */
  paths: Record<string, Vec3[]>
  /** The gait each moving block ended up in (a walk block that is too fast for a walk runs). */
  gaits: Record<string, Gait>
}

/**
 * Turns a character's blocks into keys. Each block starts where the one before it left the character (its place,
 * heading, step and pose), so blocks dropped next to each other flow into each other: moving blocks that touch carry
 * the step and the speed straight through, and actions ease in from and out to the rest pose.
 *
 * `ground` lays a block's path over the terrain (the renderer raycasts; tests pass nothing).
 */
export function compileClips(
  clips: Clip[],
  who: WalkSubject & { position: Vec3 },
  ground: (points: Vec3[], exact?: boolean) => Vec3[] = (p) => p
): CompiledClips {
  const sorted = sortedClips(clips.filter((c) => laneOf(c) === 'base'))
  const rest = who.kind === 'player' ? fullPose(who.pose) : undefined
  let carry: Carry = {
    position: [...who.position],
    rotation: [...who.rotation],
    yaw: yawOfRotation(who.rotation),
    phase: 0,
    pose: rest,
    parts: who.parts
  }
  const starts: Record<string, Vec3> = {}
  const paths: Record<string, Vec3[]> = {}
  const gaits: Record<string, Gait> = {}
  const keys: AnimKey[] = [
    { t: 0, position: [...carry.position], rotation: [...carry.rotation], pose: rest, parts: who.parts }
  ]
  let end = 0
  sorted.forEach((clip, i) => {
    // Standing between blocks: hold what the last one left.
    if (clip.start > end + 1e-3) {
      keys.push(keyOf(end, carry), keyOf(clip.start, carry))
    }
    let gait = GAIT_OF[clip.type]
    if (clip.type === 'leap') {
      starts[clip.id] = [...carry.position]
      const to: Vec3 = clip.path?.length
        ? clip.path[clip.path.length - 1]
        : defaultPath(carry.position, carry.yaw, 3)[0]
      paths[clip.id] = [[...to]]
      const r = leapKeys(clip, carry, who, rest, to)
      keys.push(...r.keys)
      const last = r.keys[r.keys.length - 1]
      carry = {
        ...carry,
        position: [...last.position],
        rotation: [...last.rotation],
        yaw: r.yaw,
        pose: rest,
        parts: last.parts
      }
    } else if (gait) {
      starts[clip.id] = [...carry.position]
      const prev = sorted[i - 1]
      const next = sorted[i + 1]
      const joinedBefore = !!prev && isMoving(prev) && clip.start - (prev.start + prev.duration) < TOUCHING
      const joinedAfter = !!next && isMoving(next) && next.start - (clip.start + clip.duration) < TOUCHING
      const waypoints = clip.path?.length
        ? clip.path
        : defaultPath(carry.position, carry.yaw, GAITS[gait].speed * clip.duration * 0.8, clip.type)
      paths[clip.id] = waypoints.map((w) => [...w])
      // Swimming and climbing leave the ground: the path is where the water and the ladder are, not the terrain.
      const raw: Vec3[] = [[...carry.position], ...waypoints]
      const points = GAITS[gait].free ? raw : ground(raw, clip.exact)
      // How fast the length asks it to go, ignoring the ramps up and down, decides how it moves.
      if (clip.type === 'walk' && clip.auto !== false) {
        const pace = new PathCurve(points).length / Math.max(0.3, clip.duration - GAITS.walk.accel * 0.5)
        gait = gaitForSpeed(pace / (who.scale || 1))
      }
      gaits[clip.id] = gait
      const r = locomotion(
        {
          points,
          gait,
          speed: 1,
          start: clip.start,
          duration: clip.duration,
          easeIn: !joinedBefore,
          easeOut: !joinedAfter,
          phase: joinedBefore ? carry.phase : 0,
          heading: clip.type === 'climb' ? (clip.face ?? carry.yaw) : undefined
        },
        { ...who, rotation: [0, (carry.yaw / D2R) % 360, 0], pose: rest, parts: who.parts }
      )
      keys.push(...r.keys)
      const last = r.keys[r.keys.length - 1]
      carry = {
        position: [...last.position],
        rotation: [...last.rotation],
        yaw: r.yaw,
        phase: r.phase,
        pose: last.pose,
        parts: last.parts
      }
    } else {
      const isAct = (c?: Clip): boolean => !!c && !isMoving(c)
      const a = actionKeys(clip, carry, who, rest, {
        before: isAct(sorted[i - 1]) && clip.start - (sorted[i - 1].start + sorted[i - 1].duration) < TOUCHING,
        after: isAct(sorted[i + 1]) && sorted[i + 1].start - (clip.start + clip.duration) < TOUCHING
      })
      keys.push(...a)
      const last = a[a.length - 1]
      // Actions end on the rest pose, on the ground where they began.
      carry = {
        ...carry,
        position: [carry.position[0], carry.position[1], carry.position[2]],
        pose: last.pose,
        parts: last.parts
      }
    }
    end = clip.start + clip.duration
  })
  let out = dedupe(keys)
  const upper = who.kind === 'player' ? clips.filter((c) => laneOf(c) === 'upper') : []
  if (upper.length) out = layerKeys(out, upper, who, rest)
  return { keys: out, starts, paths, gaits }
}

/** A spring over a gap: crouching off the edge, arms up, tucked over the middle, reaching for the far side. */
function leapKeys(
  clip: Clip,
  carry: Carry,
  who: WalkSubject & { position: Vec3 },
  rest: Pose | undefined,
  to: Vec3
): { keys: AnimKey[]; yaw: number } {
  const from = carry.position
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const dist = Math.hypot(dx, dz)
  const yaw = dist > 0.05 ? Math.atan2(dx, dz) : carry.yaw
  const rise = (0.5 + 0.12 * dist) * (who.scale || 1)
  const base = rest ?? fullPose(undefined)
  const A = over(base, {
    rightArm: [35, 0, -4],
    leftArm: [35, 0, 4],
    rightLeg: [8, 0, 0],
    leftLeg: [-12, 0, 0],
    rightShin: [10, 0, 0],
    leftShin: [30, 0, 0]
  })
  const B = over(base, {
    rightArm: [-125, 0, -14],
    leftArm: [-125, 0, 14],
    rightForearm: [-15, 0, 0],
    leftForearm: [-15, 0, 0],
    rightLeg: [-45, 0, 0],
    leftLeg: [18, 0, 0],
    rightShin: [45, 0, 0],
    leftShin: [10, 0, 0],
    head: [-8, 0, 0]
  })
  const C = over(base, {
    rightArm: [-45, 0, -10],
    leftArm: [-30, 0, 10],
    rightForearm: [-10, 0, 0],
    leftLeg: [-28, 0, 0],
    rightLeg: [-18, 0, 0],
    rightShin: [20, 0, 0],
    leftShin: [8, 0, 0]
  })
  const mix = (a: Pose, b: Pose, u: number): Pose => {
    const e = u * u * (3 - 2 * u)
    const out = fullPose(a)
    for (const n of PART_NAMES) out[n] = a[n].map((v, i) => v + (b[n][i] - v) * e) as Vec3
    return out
  }
  const n = Math.max(4, Math.ceil(clip.duration * 24))
  const keys: AnimKey[] = []
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 10 * D2R * Math.sin(Math.PI * u)))
    const key: AnimKey = {
      t: Math.round((clip.start + u * clip.duration) * 10000) / 10000,
      position: [from[0] + dx * u, from[1] + (to[1] - from[1]) * u + 4 * rise * u * (1 - u), from[2] + dz * u],
      rotation: rotationOf(q)
    }
    if (who.kind === 'player') key.pose = u < 0.5 ? mix(A, B, u * 2) : mix(B, C, (u - 0.5) * 2)
    else key.parts = structuredClone(who.parts ?? {})
    keys.push(key)
  }
  return { keys, yaw }
}

/**
 * The upper-body row laid over the keys the row below made: at every moment a block covers, the head, body and arms
 * go through the block's action while the legs and the travel carry on as they were.
 */
function layerKeys(
  base: AnimKey[],
  upper: Clip[],
  who: WalkSubject & { position: Vec3 },
  rest: Pose | undefined
): AnimKey[] {
  const times = new Set(base.map((k) => k.t))
  for (const c of upper) {
    const n = Math.max(1, Math.ceil(c.duration / ACTION_STEP))
    for (let i = 0; i <= n; i++) times.add(Math.round((c.start + (i / n) * c.duration) * 10000) / 10000)
  }
  const track = { objectId: '', keys: base }
  const out: AnimKey[] = []
  for (const t of [...times].sort((a, b) => a - b)) {
    const st = sampleTrack(track, t)
    if (!st) continue
    let pose = st.pose ? fullPose(st.pose) : (rest ?? fullPose(undefined))
    for (const c of upper) {
      const local = t - c.start
      if (local < -1e-6 || local > c.duration + 1e-6) continue
      const mode = modeOf(c) ?? 'once'
      const u = beatOf(c, Math.max(0, local))
      if (c.type === 'reach') {
        const target = c.target ?? ([who.position[0], who.position[1] + 1, who.position[2] + 1] as Vec3)
        const stance = { position: st.position, yaw: yawOfRotation(st.rotation), scale: who.scale || 1 }
        const ease = Math.min(0.35, c.duration / 3)
        const e = smoothstep(local / ease) * smoothstep((c.duration - local) / ease)
        // Held it goes there and stays; once it goes and comes back.
        pose = reachPose(
          pose,
          target,
          c.hand ?? 'right',
          stance,
          e * (mode === 'once' ? Math.sin(Math.PI * Math.min(1, u)) : 1)
        )
      } else pose = actionPose(c.type, Math.max(0, local), c.duration, pose, u, mode)
    }
    out.push({ t, position: [...st.position], rotation: [...st.rotation], pose })
  }
  return out
}

const keyOf = (t: number, c: Carry): AnimKey => ({
  t,
  position: [...c.position],
  rotation: [...c.rotation],
  pose: c.pose && fullPose(c.pose),
  parts: c.parts && structuredClone(c.parts)
})

/** Keys at (about) the same time are the same key: the later one wins. */
function dedupe(keys: AnimKey[]): AnimKey[] {
  const out: AnimKey[] = []
  for (const k of keys) {
    if (out.length && k.t - out[out.length - 1].t < 1 / 480) out[out.length - 1] = k
    else out.push(k)
  }
  return out
}

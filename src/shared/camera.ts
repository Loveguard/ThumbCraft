// The camera lane of the animation: blocks (orbit, push in, whip pan...) that move the camera, each starting where
// the one before it left it, around a character if it has one picked. Pure maths; the renderer feeds it where the
// characters are and applies the result to the viewport camera.
import * as THREE from 'three'
import type { Vec3 } from './animation'

export type CamType =
  | 'hold'
  | 'glide'
  | 'follow'
  | 'orbit'
  | 'bullet'
  | 'push'
  | 'pull'
  | 'whip'
  | 'crane'
  | 'drone'
  | 'shoulder'
  | 'hero'
  | 'dolly'
  | 'handheld'
  | 'zoom'

/** A block on the camera's row. `amount` scales how much it does (1 is the preset's own). */
export interface CamClip {
  id: string
  type: CamType
  start: number
  duration: number
  /** The character it frames and follows; none keeps to the place where the block starts. */
  subject?: string | null
  amount?: number
  /** A start view set by moving the viewport; without it the block starts where the one before it ended. */
  view?: CamView
  /** Glide blocks: the shot they move to (set with Set shot here). */
  to?: CamView
  /** Made with Set shot here: moving the view changes it only while it is selected. */
  shot?: boolean
}

export interface CamView {
  position: Vec3
  target: Vec3
  fov: number
}

export interface CameraData {
  /** The view the first block starts from (set from the viewport when the first block is added). */
  home: CamView
  clips: CamClip[]
}

export interface CamDef {
  label: string
  duration: number
  hint: string
  /** Needs a character to do its job (over the shoulder). */
  needsSubject?: boolean
}

export const CAMS: Record<CamType, CamDef> = {
  hold: { label: 'Hold', duration: 2, hint: 'Stays where it is' },
  glide: { label: 'Glide', duration: 2, hint: 'Moves smoothly from the shot before to one you set' },
  follow: { label: 'Follow', duration: 3, hint: 'Keeps its distance from the character as it moves' },
  orbit: { label: 'Orbit', duration: 4, hint: 'Circles the character' },
  bullet: { label: 'Bullet time', duration: 3, hint: 'A full turn around the character' },
  push: { label: 'Push in', duration: 2.5, hint: 'Moves in on the character' },
  pull: { label: 'Pull back', duration: 2.5, hint: 'Moves away from the character' },
  whip: { label: 'Whip pan', duration: 0.8, hint: 'Swings sideways in a hurry' },
  crane: { label: 'Crane up', duration: 3, hint: 'Rises and looks down' },
  drone: { label: 'Fly-through', duration: 5, hint: 'Flies forward and up, like a drone' },
  shoulder: {
    label: 'Over the shoulder',
    duration: 3,
    needsSubject: true,
    hint: 'Behind the character, looking where it looks'
  },
  hero: { label: 'Low hero', duration: 2.5, hint: 'Drops to the ground and looks up at the character' },
  dolly: { label: 'Dolly zoom', duration: 2.5, hint: 'Moves back while zooming in, so the background stretches' },
  handheld: { label: 'Handheld', duration: 3, hint: 'Stays put with a little hand shake' },
  zoom: { label: 'Crash zoom', duration: 0.7, hint: 'Snaps in fast, with a jolt' }
}

export const CAM_ORDER: CamType[] = [
  'hold',
  'glide',
  'follow',
  'orbit',
  'bullet',
  'push',
  'pull',
  'whip',
  'crane',
  'drone',
  'shoulder',
  'hero',
  'dolly',
  'handheld',
  'zoom'
]

/** Where a character is and which way it faces (yaw, radians; 0 faces +Z). */
export interface Subject {
  position: Vec3
  yaw: number
}

interface Planned {
  clip: CamClip
  from: CamView
}

export interface CameraPlan {
  planned: Planned[]
}

const v3 = (a: Vec3): THREE.Vector3 => new THREE.Vector3(...a)
const arr = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const UP = new THREE.Vector3(0, 1, 0)
const AIMS = new Set<CamType>(['orbit', 'bullet', 'push', 'pull', 'crane', 'drone', 'dolly', 'zoom'])
const D2R = Math.PI / 180

/** A smooth, never-repeating wobble for the hand shake (sines at unrelated rates, so no beat shows). */
const wobble = (t: number, seed: number): number =>
  (Math.sin(t * 7.3 + seed) + 0.6 * Math.sin(t * 12.9 + seed * 2.1) + 0.4 * Math.sin(t * 3.1 + seed * 0.7)) / 2

/** What a block makes of the camera `u` (0…1) of the way through it, at time `t`. */
function evaluate(
  clip: CamClip,
  from: CamView,
  u: number,
  t: number,
  subjectAt: (id: string, t: number) => Subject | null
): CamView {
  if (clip.type === 'glide') {
    const to = clip.to ?? from
    const k = smooth(u)
    const mix = (a: Vec3, b: Vec3): Vec3 => [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k
    ]
    return {
      position: mix(from.position, to.position),
      target: mix(from.target, to.target),
      fov: from.fov + (to.fov - from.fov) * k
    }
  }
  const amount = clip.amount ?? 1
  const s0 = clip.subject && clip.type !== 'hold' ? subjectAt(clip.subject, clip.start) : null
  const s = clip.subject && clip.type !== 'hold' ? subjectAt(clip.subject, t) : null
  const chest = (p: Vec3 | undefined): THREE.Vector3 => (p ? v3(p).add(new THREE.Vector3(0, 1, 0)) : v3(from.target))
  // Everything is worked out relative to a point (the character's chest, or the place the block started looking at).
  const anchor0 = chest(s0?.position)
  const anchor = s0 ? chest(s?.position ?? s0.position) : anchor0
  const p0 = v3(from.position).sub(anchor0)
  let l0 = v3(from.target).sub(anchor0)
  // Blocks that frame a character swing the aim onto it over their first moments (so a cut never shows).
  if (s0 && AIMS.has(clip.type))
    l0 = l0.multiplyScalar(1 - smooth((u * clip.duration) / Math.min(0.9, clip.duration * 0.3)))
  const e = smooth(u)
  let p = p0.clone()
  let l = l0.clone()
  let fov = from.fov
  const dir = l0.clone().sub(p0)
  const dist = Math.max(0.5, dir.length())
  dir.normalize()
  const flat = new THREE.Vector3(dir.x, 0, dir.z)
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1)
  flat.normalize()

  switch (clip.type) {
    case 'orbit':
    case 'bullet': {
      const angle = (clip.type === 'bullet' ? 360 : 120) * amount * (clip.type === 'bullet' ? e : u) * D2R
      p = p0.clone().applyAxisAngle(UP, angle)
      l = l0.clone().applyAxisAngle(UP, angle)
      break
    }
    case 'push':
      p = p0.clone().addScaledVector(dir, Math.min(dist * 0.85, dist * 0.5 * amount) * e)
      break
    case 'pull':
      p = p0.clone().addScaledVector(dir, -dist * 0.6 * amount * e)
      break
    case 'whip': {
      const turned = dir
        .clone()
        .multiplyScalar(dist)
        .applyAxisAngle(UP, 75 * amount * D2R * smooth(e))
      l = p0.clone().add(turned)
      break
    }
    case 'crane':
      p = p0
        .clone()
        .add(new THREE.Vector3(0, 4 * amount * e, 0))
        .addScaledVector(flat, -1.5 * amount * e)
      break
    case 'drone': {
      const go = flat
        .clone()
        .multiplyScalar(12 * amount * e)
        .add(new THREE.Vector3(0, 3 * amount * e, 0))
      p = p0.clone().add(go)
      l = l0.clone().add(go).applyAxisAngle(UP, 0)
      break
    }
    case 'hero': {
      const horiz = new THREE.Vector3(p0.x, 0, p0.z)
      if (horiz.lengthSq() < 1e-6) horiz.set(0, 0, -1)
      horiz.setLength(Math.max(2.5, Math.min(4.5, horiz.length())))
      const low = new THREE.Vector3(horiz.x, -0.8, horiz.z)
      p = p0.clone().lerp(low, e)
      l = l0.clone().lerp(new THREE.Vector3(0, 0.5, 0), e)
      fov = from.fov + (Math.max(from.fov, 75) - from.fov) * e
      break
    }
    case 'dolly': {
      const back = p0.clone().sub(l0)
      const d0 = Math.max(0.5, back.length())
      const d = d0 * (1 + 0.8 * amount * e)
      p = l0.clone().addScaledVector(back.normalize(), d)
      // The subject keeps its size on screen while the world behind it stretches.
      fov = (2 * Math.atan((d0 * Math.tan((from.fov * D2R) / 2)) / d)) / D2R
      break
    }
    case 'handheld': {
      const k = 0.03 * amount
      p = p0.clone().add(new THREE.Vector3(wobble(t, 1) * k, wobble(t, 2) * k, wobble(t, 3) * k))
      l = l0.clone().add(new THREE.Vector3(wobble(t, 4) * k * 2, wobble(t, 5) * k * 2, wobble(t, 6) * k * 2))
      break
    }
    case 'zoom': {
      const k = u * u * u
      fov = from.fov + (Math.max(14, from.fov * 0.35) - from.fov) * k
      const j = 0.05 * amount * Math.sin(u * Math.PI)
      l = l0.clone().add(new THREE.Vector3(wobble(t, 7) * j, wobble(t, 8) * j, 0))
      break
    }
    default:
      break
  }

  let position = anchor.clone().add(p)
  let target = anchor.clone().add(l)
  if (clip.type === 'shoulder' && s) {
    // Behind and to the right of the character, looking where it looks, easing there from where it was.
    const forward = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw))
    const right = new THREE.Vector3(-Math.cos(s.yaw), 0, Math.sin(s.yaw))
    const rigP = anchor
      .clone()
      .addScaledVector(forward, -3.4 * amount)
      .addScaledVector(right, 0.9)
      .add(new THREE.Vector3(0, 0.7, 0))
    const rigL = anchor
      .clone()
      .addScaledVector(forward, 6)
      .add(new THREE.Vector3(0, 0.1, 0))
    const b = smooth(u / 0.3)
    position = anchor0.clone().add(p0).lerp(rigP, b)
    target = anchor0.clone().add(l0).lerp(rigL, b)
  }
  return { position: arr(position), target: arr(target), fov }
}

/** Plans the blocks one after another: each starts from where the one before it ended. */
export function planCamera(
  data: CameraData | null | undefined,
  subjectAt: (id: string, t: number) => Subject | null
): CameraPlan {
  const planned: Planned[] = []
  const sorted = [...(data?.clips ?? [])].sort((a, b) => a.start - b.start)
  let from = data?.home
  for (const clip of sorted) {
    if (clip.view) from = clip.view
    if (!from) break
    planned.push({ clip, from })
    from = evaluate(clip, from, 1, clip.start + clip.duration, subjectAt)
  }
  return { planned }
}

/**
 * The camera at time `t`: inside a block that block's view; between blocks and after the last one, where the
 * previous block left it. Null before the first block, where the camera is the viewer's own.
 */
export function cameraAt(
  plan: CameraPlan,
  t: number,
  subjectAt: (id: string, t: number) => Subject | null
): CamView | null {
  let last: Planned | null = null
  for (const p of plan.planned) {
    if (t < p.clip.start - 1e-6) break
    last = p
    if (t < p.clip.start + p.clip.duration) {
      return evaluate(p.clip, p.from, (t - p.clip.start) / p.clip.duration, t, subjectAt)
    }
  }
  return last ? evaluate(last.clip, last.from, 1, last.clip.start + last.clip.duration, subjectAt) : null
}

/** Where the camera is held at the end of the last block (what the camera lane's length is for). */
export const cameraLength = (data: CameraData | null | undefined): number =>
  Math.max(0, ...(data?.clips ?? []).map((c) => c.start + c.duration))

/**
 * The start view that makes `clip` show `wanted` at time `t`: what the viewer set the camera to while the block was
 * selected, whatever the block does between its start and then. Nudges the start by the miss a few times.
 */
export function startFor(
  clip: CamClip,
  wanted: CamView,
  t: number,
  subjectAt: (id: string, t: number) => Subject | null
): CamView {
  const u = Math.min(1, Math.max(0, (t - clip.start) / Math.max(1e-6, clip.duration)))
  if (u === 0) return wanted
  const pack = (v: CamView): number[] => [...v.position, ...v.target]
  const unpack = (x: number[], fov: number): CamView => ({
    position: [x[0], x[1], x[2]],
    target: [x[3], x[4], x[5]],
    fov
  })
  const out = (x: number[]): number[] => pack(evaluate(clip, unpack(x, wanted.fov), u, t, subjectAt))
  const goal = pack(wanted)
  let x = [...goal]
  // Newton's method on the six numbers: a turning block (orbit) moves the start by more than it misses by.
  for (let i = 0; i < 6; i++) {
    const f = out(x)
    const r = goal.map((g, k) => g - f[k])
    if (Math.hypot(...r) < 1e-5) break
    const J: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0))
    for (let c = 0; c < 6; c++) {
      const y = [...x]
      y[c] += 1e-3
      const fy = out(y)
      for (let k = 0; k < 6; k++) J[k][c] = (fy[k] - f[k]) / 1e-3
    }
    const d = solve(J, r)
    if (!d) break
    x = x.map((v, k) => v + d[k])
  }
  const got = evaluate(clip, unpack(x, wanted.fov), u, t, subjectAt)
  return unpack(x, wanted.fov + (wanted.fov - got.fov))
}

/** Gaussian elimination; null when the matrix has no inverse. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-9) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const k = M[r][c] / M[c][c]
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

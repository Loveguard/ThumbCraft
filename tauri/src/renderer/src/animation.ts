// The Animation mode: a timeline over the scene. Animated objects show where the animation has them at the playhead
// (written into the scene while paused, so every handle and slider edits what you see), and any change to one of
// them while paused becomes a key at that time. The thumbnail's own positions and poses are kept aside and come
// back when you return to the Thumbnail mode.
import * as THREE from 'three'
import { create } from 'zustand'
import {
  animationLength,
  CLIPS,
  GAITS,
  compileClips,
  canLayer,
  keyAt,
  laneOf,
  mobLimbs,
  MIN_CLIP,
  NO_ANIMATION,
  PathCurve,
  placeClip,
  yawOfRotation,
  putKey,
  resizeClip as resizeClips,
  sampleTrack,
  type AnimationData,
  type AnimKey,
  type AnimState,
  type AnimTrack,
  humanoidOf,
  isMoving,
  type Clip,
  type ClipMode,
  type ClipType,
  type Gait,
  type Vec3,
  type WalkSubject
} from '@shared/animation'
import { levelAt } from '@shared/audio'
import { breathe, lookAt, talk } from '@shared/procedural'
import {
  avoidObstacles,
  blockKind,
  facingOf,
  findRoute,
  legsOf,
  standingCell,
  type Block,
  type Grid,
  type Leg
} from '@shared/pathfind'
import { clipsFrom, fromFrame, presetFrom, type Preset } from '@shared/presets'
import { withChannel } from '@shared/curves'
import { parseScript } from '@shared/script'
import {
  clampScene,
  fitsKind,
  propDef,
  putSceneKey,
  sampleScene,
  SCENE_PROPS,
  type SceneKey,
  type ScenePropId,
  type SceneTrack
} from '@shared/sceneTracks'
import type { TerrainData } from '@shared/types'
import { addPreset, usePresets } from './presetStore'
import {
  CAMS,
  cameraAt,
  startFor,
  planCamera,
  type CamClip,
  type CameraPlan,
  type CamType,
  type CamView,
  type Subject
} from '@shared/camera'
import { fullPose, PLAYER_PIXEL, type Pose } from '@shared/minecraft/playerModel'
import { viewport } from './components/Viewport'
import { applyPose } from './minecraft/builders'
import { applyMobPose } from './minecraft/mobs'
import { driveKey, driveScene, releaseScene, sceneValue } from './sceneDrive'
import {
  animationHooks,
  animationRest,
  cameraBridge,
  terrainStore,
  useStore,
  withRest,
  type SceneObject
} from './store'

export type AppMode = 'thumbnail' | 'animation'

interface AnimUi {
  mode: AppMode
  /** The playhead, in seconds. */
  time: number
  playing: boolean
  /** The block being edited: its path shows in the scene as handles. */
  selectedClip: { objectId: string; clipId: string } | null
  /** Which of its path points is picked (for removing), and whether clicking the ground adds points. */
  selectedPoint: number | null
  addingPoints: boolean
  /** The next click in the scene sets the selected Reach block's target. */
  pickingTarget: boolean
  /** The next click in the scene sends the selected character there, on the best way across. */
  goingTo: boolean
  /** How a Go to travels where it walks. */
  travel: 'walk' | 'run' | 'sprint' | 'sneak'
  /** Where each moving block starts (where the one before it ends), for drawing its path. */
  starts: Record<string, Vec3>
  /** The gait each moving block ended up in (a walk that has to be fast runs). */
  gaits: Record<string, Gait>
  /** The kind of block being dragged from the palette, to preview where it would land. */
  dragType: ClipType | CamType | null
  /** How the animation gets exported: the kind of file, its size (a preset id) and the motion blur samples. */
  exportKind: 'video' | 'gif' | 'png' | 'alpha'
  exportSize: string
  blur: number
  /** A character to keep centred in the exported frame (for a tall video cut from a wide scene). */
  follow: string | null
  /** The selected character drawn faintly a moment before and after the playhead. */
  onion: boolean
  /** Whose motion is drawn as a trail. */
  trails: 'selected' | 'all' | 'off'
  /** A short explanation to show for a moment. */
  note: string | null
  /** Undo history of the animation (the scene's own history waits until you go back to the thumbnail). */
  past: AnimationData[]
  future: AnimationData[]
}

export const useAnim = create<AnimUi>(() => ({
  mode: 'thumbnail',
  time: 0,
  playing: false,
  selectedClip: null,
  selectedPoint: null,
  addingPoints: false,
  pickingTarget: false,
  goingTo: false,
  travel: 'walk',
  starts: {},
  gaits: {},
  dragType: null,
  exportKind: 'video',
  exportSize: 'thumb',
  blur: 1,
  follow: null,
  onion: false,
  trails: 'selected',
  note: null,
  past: [],
  future: []
}))

export const animationOf = (): AnimationData => useStore.getState().settings.animation ?? NO_ANIMATION
export const trackOf = (id: string | null): AnimTrack | undefined =>
  id ? animationOf().tracks.find((t) => t.objectId === id) : undefined

/** Anything placed in 3D can move over time; players and mobs can also walk along a path. */
export const canAnimate = (o: SceneObject | undefined): boolean =>
  !!o && o.kind !== 'sticker' && !(o.kind === 'terrain' && o.ground)
/** Whether a block of this type can play on the object: players take them all, mobs built like people take most. */
export const canDo = (o: SceneObject | undefined, type: ClipType): boolean =>
  !!o && canWalk(o) && (o.kind === 'player' || !CLIPS[type].playersOnly || !!humanoidOf(mobPartPaths(o.id)))

export const canWalk = (o: SceneObject | undefined): boolean => o?.kind === 'player' || o?.kind === 'mob'

/** The parts of an object the animation drives. */
function fieldsOf(o: SceneObject): Partial<SceneObject> {
  const f: Record<string, unknown> = { position: o.position, rotation: o.rotation }
  if (o.kind === 'player') f.pose = o.pose
  if (o.kind === 'mob') f.partRotations = o.partRotations
  return f as Partial<SceneObject>
}

function stateFields(o: SceneObject, st: AnimState): Partial<SceneObject> {
  const f: Record<string, unknown> = { position: st.position, rotation: st.rotation }
  if (o.kind === 'player' && st.pose) f.pose = st.pose
  if (o.kind === 'mob' && st.parts) f.partRotations = st.parts
  return f as Partial<SceneObject>
}

function keyOf(o: SceneObject, t: number): AnimKey {
  const k: AnimKey = { t, position: [...o.position], rotation: [...o.rotation] }
  if (o.kind === 'player') k.pose = fullPose(o.pose)
  if (o.kind === 'mob') k.parts = structuredClone(o.partRotations)
  return k
}

/** What each animated object looked like when the animation last wrote it, to tell your edits from its own. */
const lastWritten = new Map<string, string>()
let writing = false

type Scene = ReturnType<typeof useStore.getState>

const write = (patch: Partial<Scene>): void => {
  writing = true
  try {
    useStore.setState(patch)
  } finally {
    writing = false
  }
}

/** Puts an object's 3D model where `o` says, right away (playback does this every frame without the store). */
function applyToScene(o: Pick<SceneObject, 'id' | 'kind'>, st: Partial<AnimState> & { position: Vec3 }): void {
  const obj = viewport.objects.get(o.id)
  if (!obj) return
  // Leave the object alone while its handles are being dragged.
  const gizmo = viewport.gizmo as { dragging?: boolean } | null
  if (gizmo?.dragging && useStore.getState().selectedId === o.id) return
  obj.position.set(...st.position)
  if (st.quaternion) obj.quaternion.copy(st.quaternion)
  else if (st.rotation) obj.rotation.set(...(st.rotation.map((v) => THREE.MathUtils.degToRad(v)) as Vec3))
  if (o.kind === 'player' && st.pose) {
    const p = obj.getObjectByName('player')
    if (p) {
      applyPose(p, st.pose)
      // Over steps and slopes, a walker's feet come up to the ground instead of sinking into it.
      if (trackOf(o.id)?.clips?.some(isMoving)) {
        const grid = groundGrid()
        if (grid) plantFeet(p, grid)
      }
    }
  }
  if (o.kind === 'mob' && st.parts) {
    const m = obj.getObjectByName('mob')
    if (m) applyMobPose(m, st.parts)
  }
}

/** The top of the ground under (x, z), looking down from `from` for about three blocks; null when there is none. */
function groundUnder(grid: Grid, x: number, z: number, from: number): number | null {
  for (let y = from; y > from - 3; y -= 0.05) if (grid.at(x, y, z) === 'solid') return Math.round((y + 0.05) * 20) / 20
  return null
}

/**
 * Keeps a walking character's feet out of the ground: a foot that has sunk below a step or slope is brought up
 * to it by swinging the leg forward and bending the knee (the body stays where the path put it).
 */
export function plantFeet(player: THREE.Object3D, grid: Grid): void {
  player.updateMatrixWorld(true)
  const sole = new THREE.Vector3()
  for (const side of ['right', 'left']) {
    const leg = player.getObjectByName(`${side}Leg`)
    const shin = player.getObjectByName(`${side}Shin`)
    if (!leg || !shin) continue
    const hip = leg.rotation.x
    const knee = shin.rotation.x
    const height = (swing: number): number => {
      leg.rotation.x = hip - swing
      shin.rotation.x = knee + swing * 1.4
      leg.updateMatrixWorld(true)
      sole.set(0, -6 * PLAYER_PIXEL, 0)
      shin.localToWorld(sole)
      return sole.y
    }
    const now = height(0)
    const floor = groundUnder(grid, sole.x, sole.z, now + 1.2)
    const sunk = floor === null ? 0 : floor - now
    if (sunk < 0.03 || sunk > 1.3) continue
    // The least swing of the leg (with the knee bent along with it) that brings the foot up to the ground.
    let lo = 0
    let hi = 1.6
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2
      if (height(mid) < floor!) lo = mid
      else hi = mid
    }
    height(hi)
  }
}

const sceneStateOf = (o: SceneObject): Partial<AnimState> & { position: Vec3 } => ({
  position: o.position,
  rotation: o.rotation,
  pose: o.kind === 'player' ? o.pose : undefined,
  parts: o.kind === 'mob' ? o.partRotations : undefined
})

/** Where a character's look-at target is at time `t`: another character's head, or the camera. */
function lookTargetAt(look: NonNullable<AnimTrack['look']>, t: number): Vec3 | null {
  if (look.target === 'camera') {
    const a = animationOf()
    const view = a.camera?.clips.length ? cameraAt(planOf(), t, subjectAt) : null
    const c = view ?? cameraBridge.get?.()
    return c ? ([c.position[0], c.position[1], c.position[2]] as Vec3) : null
  }
  const at = subjectAt(look.target, t)
  return at ? [at.position[0], at.position[1] + 1.6, at.position[2]] : null
}

/** What a track says at time `t`, with the things a character does by itself (breathing, looking) laid over it. */
export function stateAt(tr: AnimTrack, t: number, o?: SceneObject): AnimState | null {
  const st = sampleTrack(tr, t)
  if (!st?.pose || !tr.clips?.length || o?.kind !== 'player') return st
  let pose = st.pose
  if (tr.breathe !== false) pose = breathe(pose, t)
  const sound = animationOf().audio
  if (tr.talk && sound) pose = talk(pose, levelAt(sound.env, t - sound.offset), t, tr.talk.amount)
  if (tr.look && tr.look.amount > 0) {
    const target = lookTargetAt(tr.look, t)
    if (target)
      pose = lookAt(
        pose,
        { position: st.position, yaw: yawOfRotation(st.rotation), scale: o.scale || 1 },
        target,
        tr.look.amount
      )
  }
  return { ...st, pose }
}

/** Shows the animation at time `t` in the scene (and the store), as the paused view to edit. */
export function showFrame(t = useAnim.getState().time): void {
  const tracks = new Map(animationOf().tracks.map((tr) => [tr.objectId, tr]))
  const s = useStore.getState()
  let changed = false
  const objects = s.objects.map((o) => {
    const tr = tracks.get(o.id)
    const st = tr && stateAt(tr, t, o)
    if (!st) return o
    if (!animationRest.has(o.id)) animationRest.set(o.id, fieldsOf(o))
    const next = { ...o, ...stateFields(o, st) } as SceneObject
    lastWritten.set(o.id, JSON.stringify(fieldsOf(next)))
    applyToScene(o, st)
    changed = true
    return next
  })
  if (changed) write({ objects })
  driveCamera(t)
  driveWorld(t)
}

/** During playback: moves the 3D models only, every frame. */
export function posesAt(t: number): void {
  const s = useStore.getState()
  for (const tr of animationOf().tracks) {
    const o = s.objects.find((x) => x.id === tr.objectId)
    const st = o && stateAt(tr, t, o)
    if (o && st) applyToScene(o, st)
  }
  driveCamera(t)
  driveWorld(t)
}

/** Puts an object back where the thumbnail has it, and stops animating it. */
function restore(id: string): void {
  const rest = animationRest.get(id)
  animationRest.delete(id)
  lastWritten.delete(id)
  if (!rest) return
  const s = useStore.getState()
  const objects = s.objects.map((o) => (o.id === id ? ({ ...o, ...rest } as SceneObject) : o))
  write({ objects })
  const o = objects.find((x) => x.id === id)
  if (o) applyToScene(o, sceneStateOf(o))
}

/** Saves a new version of the animation, undoably. */
let batch: AnimationData | null = null
function commit(next: AnimationData): void {
  const prev = animationOf()
  // Inside a batch the steps are one: the history gets the state before the first.
  if (!batch) useAnim.setState((a) => ({ past: [...a.past.slice(-99), prev], future: [] }))
  useStore.getState().setSettings({ animation: next })
}

/** Runs several edits as one undo step. */
function inBatch<T>(fn: () => T): T {
  if (batch) return fn()
  const before = animationOf()
  batch = before
  try {
    return fn()
  } finally {
    batch = null
    if (animationOf() !== before) useAnim.setState((a) => ({ past: [...a.past.slice(-99), before], future: [] }))
  }
}

let noteTimer: ReturnType<typeof setTimeout> | undefined
function say(note: string): void {
  useAnim.setState({ note })
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => useAnim.setState({ note: null }), 5000)
}

function withTrack(a: AnimationData, id: string, fn: (t: AnimTrack) => AnimTrack | null): AnimationData {
  const existing = a.tracks.find((t) => t.objectId === id) ?? { objectId: id, keys: [] }
  const next = fn(existing)
  const others = a.tracks.filter((t) => t.objectId !== id)
  return { ...a, tracks: next && next.keys.length ? [...others, next] : others }
}

/** Your edits while paused: a change to an animated object becomes a key at the playhead. */
function onSceneChange(s: ReturnType<typeof useStore.getState>, prev: ReturnType<typeof useStore.getState>): void {
  if (writing || s.objects === prev.objects || s.project.id !== prev.project.id) return
  const { time } = useAnim.getState()
  let data = animationOf()
  let revert = false
  for (const tr of data.tracks) {
    const o = s.objects.find((x) => x.id === tr.objectId)
    if (!o) continue
    const f = JSON.stringify(fieldsOf(o))
    if (f === lastWritten.get(o.id)) continue
    if (tr.clips?.length) {
      // Blocks decide where a character is: put it back and say why.
      revert = true
      continue
    }
    lastWritten.set(o.id, f)
    data = withTrack(data, o.id, (t) => ({ ...t, keys: putKey(t.keys, keyOf(o, time)) }))
  }
  if (data !== animationOf()) commit(data)
  if (revert) {
    showFrame()
    say('This character moves by blocks. Select a block to change its path, or use Bake to keys to edit by hand.')
  }
  // Ctrl+Z undoes animation edits here; the scene's own steps would put the wrong frame back.
  if (s.past.length || s.future.length) write({ past: [], future: [] })
}

let stash: {
  past: ReturnType<typeof useStore.getState>['past']
  future: ReturnType<typeof useStore.getState>['future']
} | null = null
let unsubscribe: (() => void) | null = null

export function enterAnimation(): void {
  if (useAnim.getState().mode === 'animation') return
  const s = useStore.getState()
  stash = { past: s.past, future: s.future }
  write({ past: [], future: [], selectedJoint: null })
  useAnim.setState({ mode: 'animation', playing: false, selectedClip: null, addingPoints: false, past: [], future: [] })
  unsubscribe = useStore.subscribe(onSceneChange)
  animationHooks.exit = exitAnimation
  syncTracks()
}

export function exitAnimation(): void {
  if (useAnim.getState().mode !== 'animation') return
  releaseCamera()
  releaseScene(new Set(), write)
  releaseReveal(new Set())
  useAnim.setState({ mode: 'thumbnail', playing: false, selectedClip: null, addingPoints: false })
  unsubscribe?.()
  unsubscribe = null
  animationHooks.exit = null
  const restored = withRest(useStore.getState().objects)
  const ids = [...animationRest.keys()]
  animationRest.clear()
  lastWritten.clear()
  write({ objects: restored, past: stash?.past ?? [], future: stash?.future ?? [] })
  stash = null
  for (const id of ids) {
    const o = restored.find((x) => x.id === id)
    if (o) applyToScene(o, sceneStateOf(o))
  }
}

// ------------------------------------------------------------------ transport

/** The sound (see sound.ts) plays and stops with the timeline. */
export const soundHooks: { start?: (time: number) => void; stop?: () => void } = {}

export const play = (): void => {
  const a = useAnim.getState()
  const len = animationLength(animationOf())
  const time = a.time >= len - 1e-3 ? 0 : a.time
  useAnim.setState({ playing: true, addingPoints: false, time })
  soundHooks.start?.(time)
}

export const pause = (): void => {
  useAnim.setState({ playing: false })
  soundHooks.stop?.()
  showFrame()
}

export function seek(t: number): void {
  const time = THREE.MathUtils.clamp(t, 0, animationLength(animationOf()))
  useAnim.setState({ time })
  if (useAnim.getState().playing) {
    posesAt(time)
    soundHooks.start?.(time)
  } else showFrame(time)
}

/** Called every frame by the viewport. */
export function animationTick(delta: number): void {
  const a = useAnim.getState()
  if (a.mode !== 'animation' || !a.playing) return
  const anim = animationOf()
  const len = animationLength(anim)
  let t = a.time + Math.min(delta, 0.1)
  if (t >= len) {
    if (!anim.loop) {
      useAnim.setState({ time: len, playing: false })
      soundHooks.stop?.()
      showFrame(len)
      return
    }
    t %= len
    soundHooks.start?.(t)
  }
  useAnim.setState({ time: t })
  posesAt(t)
}

export function undoAnimation(): void {
  const a = useAnim.getState()
  const prev = a.past.at(-1)
  if (!prev) return
  useAnim.setState({ past: a.past.slice(0, -1), future: [animationOf(), ...a.future] })
  useStore.getState().setSettings({ animation: prev })
  syncTracks()
}

export function redoAnimation(): void {
  const a = useAnim.getState()
  const next = a.future[0]
  if (!next) return
  useAnim.setState({ past: [...a.past, animationOf()], future: a.future.slice(1) })
  useStore.getState().setSettings({ animation: next })
  syncTracks()
}

/** After tracks were added or removed: objects that lost theirs go back to the thumbnail, the rest show the frame. */
function syncTracks(): void {
  const ids = new Set(animationOf().tracks.map((t) => t.objectId))
  for (const id of [...animationRest.keys()]) if (!ids.has(id)) restore(id)
  // Blocks that were undone or loaded may have been cut for a different start.
  const sel = useAnim.getState().selectedClip
  if (sel && !trackOf(sel.objectId)?.clips?.some((c) => c.id === sel.clipId)) selectClip(null)
  refreshStarts()
  releaseScene(new Set(sceneOf().map(driveKey)), write)
  showFrame()
}

export function setAnimation(patch: Partial<AnimationData>): void {
  commit({ ...animationOf(), ...patch })
}

/** Like `setAnimation`, for a drag: all of it is one undo step (start it with `beginEdit`). */
export function setAnimationLive(patch: Partial<AnimationData>): void {
  apply({ ...animationOf(), ...patch }, true)
}

// ------------------------------------------------------------------ keys

/** Records how the object looks now as a key at the playhead. */
export function setKey(id: string): void {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!canAnimate(o) || !o) return
  const t = useAnim.getState().time
  commit(withTrack(animationOf(), id, (tr) => ({ ...tr, keys: putKey(tr.keys, keyOf(o, t)) })))
  showFrame()
}

export function deleteKey(id: string, index: number): void {
  commit(withTrack(animationOf(), id, (tr) => ({ ...tr, keys: tr.keys.filter((_, i) => i !== index) })))
  syncTracks()
}

/** Moves a key in time (dragging it on the timeline); it can't pass its neighbours. */
export function moveKey(id: string, index: number, t: number, merge = false): void {
  const tr = trackOf(id)
  const k = tr?.keys[index]
  if (!tr || !k) return
  const lo = index > 0 ? tr.keys[index - 1].t + 1 / 60 : 0
  const hi = index < tr.keys.length - 1 ? tr.keys[index + 1].t - 1 / 60 : Infinity
  const time = Math.round(THREE.MathUtils.clamp(t, lo, hi) * 1000) / 1000
  if (time === k.t) return
  const next = withTrack(animationOf(), id, (x) => ({
    ...x,
    keys: x.keys.map((y, i) => (i === index ? { ...y, t: time } : y))
  }))
  // One drag is one undo step.
  if (merge) useStore.getState().setSettings({ animation: next })
  else commit(next)
  showFrame()
}

/** Sets one number of a key (a joint's angle, a position…) by hand; a drag is one undo step (start it with `beginEdit`). */
export function setKeyChannel(id: string, index: number, channel: string, v: number, live = false): void {
  const tr = trackOf(id)
  if (!tr?.keys[index] || tr.clips?.length) return
  apply(
    withTrack(animationOf(), id, (x) => ({
      ...x,
      keys: x.keys.map((k, i) => (i === index ? withChannel(k, channel, v) : k))
    })),
    live
  )
}

export function clearTrack(id: string): void {
  commit(withTrack(animationOf(), id, () => null))
  syncTracks()
}

export const keyIndexAtPlayhead = (id: string | null): number => {
  const tr = trackOf(id)
  return tr ? keyAt(tr.keys, useAnim.getState().time) : -1
}

// ------------------------------------------------------------------ blocks

/** The model parts of a mob as built in the scene (their paths), to find its legs. */
function mobPartPaths(id: string): string[] {
  const paths: string[] = []
  viewport.objects
    .get(id)
    ?.getObjectByName('mob')
    ?.traverse((o) => {
      if (o.userData.mobPart && o.name) paths.push(o.name)
    })
  return paths
}

const ray = new THREE.Raycaster()
const DOWN = new THREE.Vector3(0, -1, 0)

/** The things a character can stand on: terrain, builds and models. */
function solids(objects: SceneObject[]): THREE.Object3D[] {
  const ids = new Set(objects.filter((o) => o.kind === 'terrain' || o.kind === 'model').map((o) => o.id))
  return [...viewport.objects].filter(([id, o]) => ids.has(id) && o.visible).map(([, o]) => o)
}

/** The height of the ground below (x, z), looking down from `from`; null when there is none. */
function groundBelow(targets: THREE.Object3D[], x: number, from: number, z: number): number | null {
  ray.set(new THREE.Vector3(x, from, z), DOWN)
  ray.far = 64
  // Only tops of things count: the crossed quads of flowers and grass are walked through, not onto.
  const hit = ray.intersectObjects(targets, true).find((h) => {
    if (!h.face || h.face.normal.clone().transformDirection(h.object.matrixWorld).y < 0.5) return false
    for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible || o.userData.helper) return false
    return true
  })
  return hit ? hit.point.y : null
}

/**
 * The path laid over the ground: a point every half block, dropped onto (or stepped up to) the terrain, builds and
 * models there, so characters walk over hills and steps instead of through them.
 */
function onGround(points: Vec3[], objects: SceneObject[], exact = false): Vec3[] {
  const targets = solids(objects)
  if (!targets.length) return points
  const curve = new PathCurve(points)
  const n = Math.max(1, Math.ceil(curve.length / 0.5))
  let last = points[0][1]
  const out: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const p = curve.pointAt((i / n) * curve.length)
    // Look down from just over a block above where the feet were: up one step at a time (never into the trees
    // overhead, and never more than two blocks over the line you drew), or down any drop.
    const hit = groundBelow(targets, p.x, Math.min(last + 1.1, p.y + 2.1), p.z)
    // A route's own heights are good to a step: a ground far from them is a ladder's foot, not the floor.
    last = hit !== null && (!exact || Math.abs(hit - p.y) <= 1.2) ? hit : p.y
    out.push([p.x, last, p.z])
  }
  return out
}

/** A point set down on the ground under it, for a path handle. */
export function dropPoint(p: Vec3): Vec3 {
  const y = groundBelow(solids(useStore.getState().objects), p[0], p[1] + 2.1, p[2])
  return [p[0], y ?? p[1], p[2]]
}

/** The character as the blocks should start it: the thumbnail's own place, facing and pose. */
function subjectOf(id: string): (WalkSubject & { position: Vec3 }) | null {
  const shown = useStore.getState().objects.find((x) => x.id === id)
  if (!shown || !canWalk(shown)) return null
  const rest = { ...shown, ...(animationRest.get(id) ?? {}) } as SceneObject
  return {
    kind: shown.kind === 'player' ? 'player' : 'mob',
    scale: shown.scale,
    rotation: rest.rotation,
    position: rest.position,
    pose: rest.kind === 'player' ? rest.pose : undefined,
    parts: rest.kind === 'mob' ? rest.partRotations : undefined,
    limbs: shown.kind === 'mob' ? mobLimbs(mobPartPaths(id)) : undefined,
    humanoid: shown.kind === 'mob' ? humanoidOf(mobPartPaths(id)) : undefined
  }
}

/** Makes the track's keys from its blocks. `fast` skips laying paths over the terrain (while a handle is dragged). */
function rebuildTrack(tr: AnimTrack, fast = false): AnimTrack {
  const who = tr.clips?.length ? subjectOf(tr.objectId) : null
  if (!tr.clips || !who) return tr
  const objects = useStore.getState().objects
  // A path that runs into a wall or a tree is walked round it (terrain blocks only; routes already found stay put).
  const grid = fast ? null : terrainGrid(objects)
  const r = compileClips(
    tr.clips,
    who,
    fast ? undefined : (pts, exact) => onGround(grid && !exact ? avoidObstacles(grid, pts) : pts, objects, exact)
  )
  useAnim.setState((a) => ({ starts: { ...a.starts, ...r.starts }, gaits: { ...a.gaits, ...r.gaits } }))
  // A moving block with no path of its own is given the one it walked, so it has handles to move.
  const clips = tr.clips.map((c) =>
    isMoving(c) && !c.path?.length && r.paths[c.id]
      ? { ...c, path: fast ? r.paths[c.id] : r.paths[c.id].map(dropPoint) }
      : c
  )
  return { ...tr, clips, keys: r.keys }
}

function refreshStarts(): void {
  for (const tr of animationOf().tracks) if (tr.clips?.length) rebuildTrack(tr, true)
}

let pending: AnimationData | null = null
/** Starts a drag: all its changes together are one undo step. */
export const beginEdit = (): void => void (pending = animationOf())

function apply(next: AnimationData, live: boolean): void {
  if (live) {
    if (pending) {
      const prev = pending
      useAnim.setState((a) => ({ past: [...a.past.slice(-99), prev], future: [] }))
      pending = null
    }
    useStore.getState().setSettings({ animation: next })
  } else commit(next)
  showFrame()
}

function editClips(id: string, fn: (clips: Clip[]) => Clip[] | null, live = false): boolean {
  const clips = fn(trackOf(id)?.clips ?? [])
  if (!clips) return false
  apply(
    withTrack(animationOf(), id, (t) => rebuildTrack({ ...t, clips }, live)),
    live
  )
  return true
}

/** Ends a drag: lays the blocks' paths over the terrain properly. */
export function finishEdit(id: string): void {
  pending = null
  if (id === CAMERA) return
  const tr = trackOf(id)
  if (!tr?.clips) return
  useStore.getState().setSettings({ animation: withTrack(animationOf(), id, (t) => rebuildTrack(t)) })
  showFrame()
}

export function selectClip(sel: { objectId: string; clipId: string } | null): void {
  useAnim.setState({
    selectedClip: sel,
    selectedPoint: null,
    addingPoints: false,
    pickingTarget: false,
    goingTo: false
  })
  if (sel && sel.objectId !== CAMERA) useStore.getState().select(sel.objectId)
}

export const clipOf = (sel: { objectId: string; clipId: string } | null): Clip | undefined =>
  sel ? trackOf(sel.objectId)?.clips?.find((c) => c.id === sel.clipId) : undefined

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** Puts a new block on a character's row: where asked if there is room there, else the nearest room. */
export function addClip(id: string, type: ClipType, at?: number, layer?: 'upper'): void {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!o || !canWalk(o)) return
  if (!canDo(o, type)) {
    say(`${CLIPS[type].label} is only for players and mobs built like them (zombies, skeletons, piglins…).`)
    return
  }
  if (useAnim.getState().playing) pause()
  // The thumbnail's own place and pose, before the animation starts to write over them.
  if (!animationRest.has(id)) animationRest.set(id, fieldsOf(o))
  const all = trackOf(id)?.clips ?? []
  if (layer && (o.kind !== 'player' || !canLayer(type))) {
    say(`${CLIPS[type].label} can't go on the upper body row.`)
    return
  }
  const clips = all.filter((c) => laneOf(c) === (layer ?? 'base'))
  const end = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const spot = placeClip(clips, { start: at ?? end, duration: CLIPS[type].duration })
  if (!spot) {
    say('There is no room for that block there.')
    return
  }
  const clip: Clip = {
    id: crypto.randomUUID(),
    type,
    start: round3(spot.start),
    duration: round3(spot.duration),
    ...(layer ? { layer } : {})
  }
  if (type === 'reach') {
    // In front of the character at chest height, until it is put on something.
    const at = subjectAt(id, clip.start)
    if (at)
      clip.target = [
        round3(at.position[0] + Math.sin(at.yaw) * 0.9),
        round3(at.position[1] + 1),
        round3(at.position[2] + Math.cos(at.yaw) * 0.9)
      ]
  }
  editClips(id, (c) => [...c, clip])
  selectClip({ objectId: id, clipId: clip.id })
}

export function moveClip(id: string, clipId: string, start: number, live = false): void {
  if (id === CAMERA) return moveCamClip(clipId, start, live)
  editClips(
    id,
    (clips) => {
      const c = clips.find((x) => x.id === clipId)
      const spot =
        c &&
        placeClip(
          clips.filter((x) => x !== c && laneOf(x) === laneOf(c)),
          { start, duration: c.duration },
          c.duration
        )
      if (!c || !spot || Math.abs(spot.start - c.start) < 1e-4) return null
      return clips.map((x) => (x === c ? { ...x, start: round3(spot.start) } : x))
    },
    live
  )
}

export function resizeClip(id: string, clipId: string, edge: 'start' | 'end', t: number, live = false): void {
  if (id === CAMERA) return resizeCamClip(clipId, edge, t, live)
  editClips(
    id,
    (clips) => {
      const lane = laneOf(clips.find((x) => x.id === clipId) ?? {})
      const grown = new Map(
        resizeClips(
          clips.filter((x) => laneOf(x) === lane),
          clipId,
          edge,
          t,
          MIN_CLIP
        ).map((x) => [x.id, x])
      )
      const next = clips.map((x) => {
        const y = grown.get(x.id) ?? x
        return { ...y, start: round3(y.start), duration: round3(y.duration) }
      })
      return JSON.stringify(next) === JSON.stringify(clips) ? null : next
    },
    live
  )
}

export function setClipDuration(id: string, clipId: string, seconds: number): void {
  const c = id === CAMERA ? camClipOf({ objectId: id, clipId }) : trackOf(id)?.clips?.find((x) => x.id === clipId)
  if (c) resizeClip(id, clipId, 'end', c.start + seconds)
}

export function deleteClip(id: string, clipId: string): void {
  if (id === CAMERA) return deleteCamClip(clipId)
  const left = (trackOf(id)?.clips ?? []).filter((c) => c.id !== clipId)
  useAnim.setState({ selectedClip: null, selectedPoint: null, addingPoints: false })
  if (!left.length) clearTrack(id)
  else editClips(id, () => left)
}

/** Sets how an action plays (loop, once or hold), or whether a walk may break into a run. */
export function setClipMode(id: string, clipId: string, mode: ClipMode): void {
  editClips(id, (clips) => clips.map((c) => (c.id === clipId ? { ...c, mode } : c)))
}

// ------------------------------------------------------------------ going places

const kindCache = new WeakMap<TerrainData, Block[]>()
const kindsOf = (t: TerrainData): Block[] => {
  let k = kindCache.get(t)
  if (!k) kindCache.set(t, (k = t.palette.map((b) => blockKind(b.name, b.properties))))
  return k
}

let gridFor: { objects: SceneObject[]; grid: Grid | null } | null = null
/** `terrainGrid` of the scene as it is, kept until the objects change. */
function groundGrid(): Grid | null {
  const objects = useStore.getState().objects
  if (gridFor?.objects !== objects) gridFor = { objects, grid: terrainGrid(objects) }
  return gridFor.grid
}

/** The blocks of the scene's terrain and builds, as the route finder wants them (world coordinates, unturned). */
export function terrainGrid(objects: SceneObject[]): Grid | null {
  const sources = objects.flatMap((o) => {
    if (o.kind !== 'terrain' || !o.visible) return []
    const t = terrainStore.get(o.terrainId)
    // Turned or resized builds don't line up with the block grid: left out.
    if (!t || o.scale !== 1 || o.rotation.some((r) => Math.abs(r) > 1e-3)) return []
    return [
      { t, kinds: kindsOf(t), ox: o.position[0] - t.sizeX / 2, oy: o.position[1], oz: o.position[2] - t.sizeZ / 2 }
    ]
  })
  if (!sources.length) return null
  const blockAt = (x: number, y: number, z: number): { s: (typeof sources)[number]; i: number } | null => {
    let found: { s: (typeof sources)[number]; i: number } | null = null
    for (const s of sources) {
      const lx = Math.floor(x + 0.5 - s.ox)
      const ly = Math.floor(y + 0.5 - s.oy)
      const lz = Math.floor(z + 0.5 - s.oz)
      if (lx < 0 || ly < 0 || lz < 0 || lx >= s.t.sizeX || ly >= s.t.sizeY || lz >= s.t.sizeZ) continue
      const i = s.t.blocks[lx + lz * s.t.sizeX + ly * s.t.sizeX * s.t.sizeZ]
      if (s.kinds[i] !== 'air' && s.t.palette[i]) return { s, i }
      found ??= { s, i }
    }
    return found
  }
  return {
    at: (x, y, z) => {
      const b = blockAt(x, y, z)
      return b ? b.s.kinds[b.i] : 'air'
    },
    facing: (x, y, z) => {
      const b = blockAt(x, y, z)
      return b ? facingOf(b.s.t.palette[b.i]?.properties) : null
    }
  }
}

const LEG_CLIP: Record<Leg['move'], ClipType | null> = { walk: null, swim: 'swim', climb: 'climb', leap: 'leap' }

/** Seconds a stretch of the route takes, from how fast it is done. */
function legSeconds(leg: Leg, gait: Gait): number {
  const length = new PathCurve(leg.points).length
  if (leg.move === 'leap') {
    const d = Math.hypot(leg.points[1][0] - leg.points[0][0], leg.points[1][2] - leg.points[0][2])
    return round3(0.45 + 0.12 * d)
  }
  const g = GAITS[leg.move === 'walk' ? gait : leg.move]
  return round3(Math.max(MIN_CLIP, length / g.speed + g.accel))
}

/**
 * Sends a character to a spot: finds the way across the blocks (steps, water, ladders, gaps) and lays it on the
 * timeline as ordinary blocks (Walk, Swim, Climb, Leap), one after the other, after the ones it already has.
 */
export function goTo(id: string, dest: Vec3): boolean {
  const s = useStore.getState()
  const o = s.objects.find((x) => x.id === id)
  if (!o || !canWalk(o)) return false
  if (useAnim.getState().playing) pause()
  const grid = terrainGrid(s.objects.filter((x) => x.id !== id))
  if (!grid) {
    say('There is no terrain here to find a way across.')
    return false
  }
  if (!animationRest.has(id)) animationRest.set(id, fieldsOf(o))
  const clips = trackOf(id)?.clips ?? []
  const base = clips.filter((c) => laneOf(c) === 'base')
  const end = base.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const tr = trackOf(id)
  const where =
    (tr?.keys.length ? sampleTrack(tr, end)?.position : null) ?? (animationRest.get(id)?.position as Vec3) ?? o.position
  const from = standingCell(grid, where)
  const to = standingCell(grid, dest)
  if (!from || !to) {
    say(!from ? 'It has nothing to stand on where it is.' : 'There is nowhere to stand there.')
    return false
  }
  const route = findRoute(grid, from, to)
  const legs = legsOf(route.steps, grid)
  if (!legs.length) {
    say('It is already there.')
    return false
  }
  const gait: Gait = useAnim.getState().travel
  let at = end
  const added: Clip[] = legs.map((leg) => {
    const duration = legSeconds(leg, gait)
    const type = LEG_CLIP[leg.move] ?? gait
    const clip: Clip = {
      id: crypto.randomUUID(),
      type: type as ClipType,
      start: round3(at),
      duration,
      path: leg.points.slice(1).map((p) => p.map(round3) as Vec3),
      exact: true,
      ...(leg.face !== undefined ? { face: round3(leg.face) } : {}),
      // A walk here keeps the gait it was sent with.
      ...(type === 'walk' ? { auto: false } : {})
    }
    at += duration
    return clip
  })
  editClips(id, (c) => [...c, ...added])
  selectClip({ objectId: id, clipId: added[added.length - 1].id })
  const how = [...new Set(legs.map((l) => l.move).filter((m) => m !== 'walk'))]
  say(
    route.reached
      ? `Found a way: ${legs.length === 1 ? 'one block' : `${legs.length} blocks`}${how.length ? `, with ${how.join(' and ')}` : ''}.`
      : 'There is no way there, so it goes as near as it can.'
  )
  return true
}

/** Makes a character look toward another character or the camera (null: not at all). */
export function setLook(id: string, look: AnimTrack['look']): void {
  commit(withTrack(animationOf(), id, (t) => ({ ...t, look })))
  showFrame()
}

export function setTalk(id: string, talk: AnimTrack['talk']): void {
  commit(withTrack(animationOf(), id, (t) => ({ ...t, talk })))
  showFrame()
}

export function setBreathe(id: string, on: boolean): void {
  commit(withTrack(animationOf(), id, (t) => ({ ...t, breathe: on })))
  showFrame()
}

/** Where a Reach block's hand goes, and which hand. */
export function setClipReach(
  id: string,
  clipId: string,
  patch: { target?: Vec3; hand?: 'left' | 'right' },
  live = false
): void {
  editClips(id, (clips) => clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)), live)
}

/** Moves a block between the body row and the upper body row (when its kind allows). */
export function setClipLayer(id: string, clipId: string, layer: 'upper' | undefined): void {
  const o = useStore.getState().objects.find((x) => x.id === id)
  editClips(id, (clips) => {
    const c = clips.find((x) => x.id === clipId)
    if (!c || (layer && (o?.kind !== 'player' || !canLayer(c.type)))) return null
    const spot = placeClip(
      clips.filter((x) => x !== c && laneOf(x) === (layer ?? 'base')),
      { start: c.start, duration: c.duration },
      c.duration
    )
    if (!spot) {
      say('There is no room for that block on that row.')
      return null
    }
    return clips.map((x) => {
      if (x !== c) return x
      const { layer: _old, ...rest } = x
      return { ...rest, start: round3(spot.start), ...(layer ? { layer } : {}) }
    })
  })
}

export function setClipAuto(id: string, clipId: string, auto: boolean): void {
  editClips(id, (clips) => clips.map((c) => (c.id === clipId ? { ...c, auto } : c)))
}

export function setClipType(id: string, clipId: string, type: ClipType): void {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!o || !canDo(o, type)) return
  editClips(id, (clips) =>
    clips.map((c) => (c.id === clipId ? { ...c, type, path: CLIPS[type].moves ? c.path : undefined } : c))
  )
}

function editPath(id: string, clipId: string, fn: (path: Vec3[]) => Vec3[] | null, live = false): void {
  editClips(
    id,
    (clips) => {
      const c = clips.find((x) => x.id === clipId)
      const path = c?.path && fn(c.path)
      return path ? clips.map((x) => (x === c ? { ...x, path } : x)) : null
    },
    live
  )
}

export const setPathPoint = (id: string, clipId: string, index: number, p: Vec3, live = false): void =>
  editPath(id, clipId, (path) => path.map((q, i) => (i === index ? p : q)), live)

export function addClipPoint(p: Vec3): void {
  const sel = useAnim.getState().selectedClip
  if (!sel) return
  editPath(sel.objectId, sel.clipId, (path) => [...path, dropPoint(p)])
  const n = clipOf(sel)?.path?.length
  if (n) useAnim.setState({ selectedPoint: n - 1 })
}

export function removePathPoint(index: number): void {
  const sel = useAnim.getState().selectedClip
  if (!sel) return
  // A path keeps at least one point beyond its start.
  editPath(sel.objectId, sel.clipId, (path) => (path.length > 1 ? path.filter((_, i) => i !== index) : null))
  useAnim.setState({ selectedPoint: null })
}

/** Throws the path away: the block heads straight ahead again. */
export function resetPath(id: string, clipId: string): void {
  editClips(id, (clips) => clips.map((c) => (c.id === clipId ? { ...c, path: undefined } : c)))
}

/** Keeps the motion as plain keys and drops the blocks, to edit them by hand. */
export function bakeClips(id: string): void {
  useAnim.setState({ selectedClip: null, selectedPoint: null, addingPoints: false })
  commit(withTrack(animationOf(), id, (t) => ({ ...t, clips: undefined })))
}

// ------------------------------------------------------------------ copy and paste

let clipboard:
  | { type: ClipType; duration: number; mode?: ClipMode; layer?: 'upper'; target?: Vec3; hand?: 'left' | 'right' }
  | { camera: true; type: CamType; duration: number; subject?: string | null; amount?: number }
  | null = null
export const hasClipboard = (): boolean => clipboard !== null

export function copyClip(sel = useAnim.getState().selectedClip): void {
  const cam = camClipOf(sel)
  if (cam) {
    clipboard = { camera: true, type: cam.type, duration: cam.duration, subject: cam.subject, amount: cam.amount }
    return
  }
  const c = clipOf(sel)
  if (c)
    clipboard = { type: c.type, duration: c.duration, mode: c.mode, layer: c.layer, target: c.target, hand: c.hand }
}

export function cutClip(sel = useAnim.getState().selectedClip): void {
  if (!sel || !(clipOf(sel) || camClipOf(sel))) return
  copyClip(sel)
  deleteClip(sel.objectId, sel.clipId)
}

/** Puts the copied block on a character's row at `at` (default: the end of its blocks), with a straight path. */
export function pasteClip(objectId: string, at?: number, lane?: 'base' | 'upper'): void {
  if (!clipboard) return
  if ('camera' in clipboard) {
    if (objectId !== CAMERA) return
    const before = new Set((animationOf().camera?.clips ?? []).map((c) => c.id))
    const { type, duration, subject, amount } = clipboard
    addCamClip(type, at, duration)
    const added = animationOf().camera?.clips.find((c) => !before.has(c.id))
    if (added) setCamClip(added.id, { subject, amount })
    return
  }
  if (objectId === CAMERA) return
  const before = new Set((trackOf(objectId)?.clips ?? []).map((c) => c.id))
  const { type, duration, mode, target, hand } = clipboard
  const layer = (lane ?? clipboard.layer ?? 'base') === 'upper' ? 'upper' : undefined
  addClip(objectId, type, at, layer)
  const added = trackOf(objectId)?.clips?.find((c) => !before.has(c.id))
  if (added && mode) setClipMode(objectId, added.id, mode)
  if (added && (target || hand)) setClipReach(objectId, added.id, { target, hand })
  if (added && Math.abs(added.duration - duration) > 1e-3) setClipDuration(objectId, added.id, duration)
}

/** A copy right after the block, or at the first room after it. */
export function duplicateClip(sel = useAnim.getState().selectedClip): void {
  const c = clipOf(sel) ?? camClipOf(sel)
  if (!sel || !c) return
  const saved = clipboard
  copyClip(sel)
  pasteClip(sel.objectId, c.start + c.duration)
  clipboard = saved
}

/** Gives a player this motion as plain keys (from a file): its blocks, if it had any, are replaced. */
export function importPoseKeys(id: string, samples: { t: number; pose: Pose; root?: Vec3 }[], loop: boolean): void {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!o || o.kind !== 'player' || !samples.length) return
  if (useAnim.getState().playing) pause()
  if (!animationRest.has(id)) animationRest.set(id, fieldsOf(o))
  const rest = animationRest.get(id) as { position: Vec3; rotation: Vec3 }
  const origin = { position: rest.position, yaw: yawOfRotation(rest.rotation) }
  const keys: AnimKey[] = samples.map((s) => ({
    t: round3(s.t),
    position: s.root ? fromFrame(s.root, origin) : [...rest.position],
    rotation: [...rest.rotation],
    pose: fullPose(s.pose)
  }))
  useAnim.setState({ selectedClip: null, selectedPoint: null, addingPoints: false })
  commit({ ...withTrack(animationOf(), id, () => ({ objectId: id, keys })), loop })
  showFrame()
  syncTracks()
}

// ------------------------------------------------------------------ text to blocks

/**
 * A first draft from a sentence: "Alex walks to the cave, sees the Warden, panics, runs" becomes blocks on Alex's
 * row (and camera blocks for the camera's), the same blocks as from the palette. One undo takes it all back.
 */
export function draftFromText(text: string): { added: number; unknown: string[] } | null {
  const objects = useStore.getState().objects
  const chars = objects.filter(canWalk)
  if (!chars.length) {
    say('Add a player or a mob first, then describe what it does.')
    return null
  }
  const selected = objects.find((o) => o.id === useStore.getState().selectedId && canWalk(o)) ?? chars[0]
  const parsed = parseScript(text, {
    characters: chars.map((c) => c.name),
    places: objects
      .filter((o) => !canWalk(o) && o.kind !== 'terrain')
      .map((o) => o.name)
      .concat(objects.filter((o) => o.kind === 'terrain' && !o.ground).map((o) => o.name))
  })
  const byName = (name: string | null): SceneObject | undefined => objects.find((o) => o.name === name)
  const before = animationOf()
  const travel = useAnim.getState().travel
  let added = 0
  const lastStart = new Map<string, number>()
  inBatch(() => {
    for (const step of parsed.steps) {
      const who = (byName(step.subject) && canWalk(byName(step.subject)!) ? byName(step.subject) : selected)!
      const endOf = (): number =>
        round3((trackOf(who.id)?.clips ?? []).reduce((m, c) => Math.max(m, c.start + c.duration), 0))
      const t0 = endOf()
      const known = new Set((trackOf(who.id)?.clips ?? []).map((c) => c.id))
      const newest = (): Clip | undefined => (trackOf(who.id)?.clips ?? []).find((c) => !known.has(c.id))
      if (step.kind === 'clip') {
        addClip(who.id, step.type)
        const c = newest()
        if (!c) continue
        if (step.duration) setClipDuration(who.id, c.id, step.duration)
        const place = step.target ? byName(step.target) : undefined
        if (place && step.type === 'reach')
          setClipReach(who.id, c.id, { target: [place.position[0], place.position[1] + 1, place.position[2]] })
        added++
        lastStart.set(who.id, t0)
      } else if (step.kind === 'go') {
        const place = step.to ? byName(step.to) : undefined
        useAnim.setState({ travel: step.gait })
        const n = (trackOf(who.id)?.clips ?? []).length
        if (!(place && goTo(who.id, place.position as Vec3))) {
          // No route to find (no terrain, or nowhere to stand there): straight toward it, or straight ahead.
          const at = subjectAt(who.id, t0)
          if (at) {
            const g = GAITS[step.gait]
            const dest: Vec3 = place
              ? [place.position[0], at.position[1], place.position[2]]
              : [
                  at.position[0] + Math.sin(at.yaw) * (step.blocks ?? 6),
                  at.position[1],
                  at.position[2] + Math.cos(at.yaw) * (step.blocks ?? 6)
                ]
            const length = Math.hypot(dest[0] - at.position[0], dest[2] - at.position[2])
            const clip: Clip = {
              id: crypto.randomUUID(),
              type: step.gait,
              start: t0,
              duration: round3(Math.max(MIN_CLIP, length / g.speed + g.accel)),
              path: [dest.map(round3) as Vec3],
              ...(step.gait === 'walk' ? { auto: false } : {})
            }
            editClips(who.id, (c) => [...c, clip])
          }
        }
        added += Math.max(1, (trackOf(who.id)?.clips ?? []).length - n)
        lastStart.set(who.id, t0)
      } else if (step.kind === 'look') {
        const target = byName(step.at)
        if (target) {
          addClip(who.id, 'idle')
          const c = newest()
          if (c) setClipDuration(who.id, c.id, 1.2)
          setLook(who.id, { target: target.id, amount: 1 })
          added++
          lastStart.set(who.id, t0)
        }
      } else {
        const at = lastStart.get(who.id) ?? 0
        const duration = step.duration ?? CAMS[step.type].duration
        const clips = animationOf().camera?.clips ?? []
        const spot = placeClip(clips, { start: at, duration })
        if (spot) {
          const sel = useStore.getState().selectedId
          useStore.getState().select(who.id)
          addCamClip(step.type, spot.start, spot.duration)
          useStore.getState().select(sel)
          added++
        }
      }
    }
  })
  useAnim.setState({ travel })
  if (animationOf() === before) say('Nothing there I know how to draw. Try "Alex walks to the cave, waves, runs".')
  else
    say(
      `Drafted ${added} block${added === 1 ? '' : 's'}${parsed.unknown.length ? `. Didn't follow: ${parsed.unknown.join('; ')}` : ''}.`
    )
  return { added, unknown: parsed.unknown }
}

// ------------------------------------------------------------------ presets

/** Saves a block (or, with no block, all of a character's blocks) as a preset to use again. */
export function saveAsPreset(objectId: string, clipId?: string): void {
  const tr = trackOf(objectId)
  const clips = (tr?.clips ?? []).filter((c) => !clipId || c.id === clipId)
  if (!clips.length) return
  const first = Math.min(...clips.map((c) => c.start))
  const at = subjectAt(objectId, first)
  if (!at) return
  const name = clipId ? CLIPS[clips[0].type].label : useStore.getState().objects.find((o) => o.id === objectId)?.name
  const cams = (animationOf().camera?.clips ?? []).map((c) => ({ ...c, self: c.subject === objectId }))
  const end = Math.max(...clips.map((c) => c.start + c.duration))
  const preset = presetFrom(
    `${name ?? 'My'} preset ${usePresets.getState().presets.length + 1}`,
    clips,
    at,
    clipId ? [] : cams.filter((c) => c.start < end && c.start + c.duration > first)
  )
  addPreset(preset)
  say(`Saved "${preset.name}" in your presets.`)
}

/** Puts a saved preset on a character's row after what it already does, starting from where it stands then. */
export function applyPreset(p: Preset, objectId: string): void {
  const o = useStore.getState().objects.find((x) => x.id === objectId)
  if (!o || !canWalk(o)) return
  if (useAnim.getState().playing) pause()
  if (!animationRest.has(objectId)) animationRest.set(objectId, fieldsOf(o))
  const have = trackOf(objectId)?.clips ?? []
  const at = round3(have.reduce((m, c) => Math.max(m, c.start + c.duration), 0))
  const origin = subjectAt(objectId, at)
  if (!origin) return
  const made = clipsFrom(p, at, origin)
  // A mob can't do what only a player can.
  const fits = made.filter((c) => canDo(o, c.type) && (o.kind === 'player' || !c.layer))
  if (!fits.length) {
    say('That preset is for players.')
    return
  }
  editClips(objectId, (c) => [...c, ...fits])
  const cams = p.camera ?? []
  if (cams.length) {
    const clips = animationOf().camera?.clips ?? []
    let next = clips
    for (const c of cams) {
      const spot = placeClip(next, { start: at + c.offset, duration: c.duration })
      if (!spot) continue
      next = [
        ...next,
        {
          id: crypto.randomUUID(),
          type: c.type,
          start: round3(spot.start),
          duration: round3(spot.duration),
          subject: c.self ? objectId : null,
          ...(c.amount !== undefined ? { amount: c.amount } : {})
        }
      ]
    }
    if (next !== clips) editCamera(() => next)
  }
  selectClip({ objectId, clipId: fits[0].id })
  say(`Added "${p.name}".`)
}

// ------------------------------------------------------------------ camera

/** The id the camera's row of the timeline goes by (it is not an object in the scene). */
export const CAMERA = '__camera__'

/** Where a character is and which way it faces at time `t`, as the animation (or else the scene) has it. */
function subjectAt(id: string, t: number): Subject | null {
  const o = useStore.getState().objects.find((x) => x.id === id)
  if (!o) return null
  const tr = trackOf(id)
  const st = tr && sampleTrack(tr, t)
  const rest = animationRest.get(id) as Partial<SceneObject> | undefined
  const position = st?.position ?? (rest?.position as Vec3 | undefined) ?? o.position
  const rotation = st?.rotation ?? (rest?.rotation as Vec3 | undefined) ?? o.rotation
  return { position, yaw: yawOfRotation(rotation) }
}

let planned: { camera: unknown; tracks: unknown; plan: CameraPlan } | null = null
function planOf(): CameraPlan {
  const a = animationOf()
  if (!planned || planned.camera !== a.camera || planned.tracks !== a.tracks)
    planned = { camera: a.camera, tracks: a.tracks, plan: planCamera(a.camera, subjectAt) }
  return planned.plan
}

let driven = false

/** Shows the camera lane's view at time `t` in the viewport (nothing before its first block: the camera is yours). */
function driveCamera(t: number): void {
  if (useAnim.getState().mode !== 'animation') return
  const view = animationOf().camera?.clips.length ? cameraAt(planOf(), t, subjectAt) : null
  if (!view) {
    if (driven) releaseCamera()
    return
  }
  driven = true
  setView(view)
}

function setView(view: CamView): void {
  cameraBridge.set?.({ position: view.position, target: view.target })
  const cam = viewport.camera
  if (cam && Math.abs(cam.fov - view.fov) > 1e-4) {
    cam.fov = view.fov
    cam.updateProjectionMatrix()
  }
}

/** Hands the camera back: to where it was before the first block, with the scene's own field of view. */
function releaseCamera(): void {
  if (!driven) return
  driven = false
  const home = animationOf().camera?.home
  if (home) setView({ ...home, fov: useStore.getState().settings.fov })
  const cam = viewport.camera
  if (cam) {
    cam.fov = useStore.getState().settings.fov
    cam.updateProjectionMatrix()
  }
}

export const camClipOf = (sel: { objectId: string; clipId: string } | null): CamClip | undefined =>
  sel?.objectId === CAMERA ? animationOf().camera?.clips.find((c) => c.id === sel.clipId) : undefined

/** The viewport's camera as it is now, to start the camera lane from. */
function currentView(): CamView | null {
  const c = cameraBridge.get?.()
  return c ? { ...c, fov: viewport.camera?.fov ?? useStore.getState().settings.fov } : null
}

function editCamera(fn: (clips: CamClip[]) => CamClip[] | null, live = false): boolean {
  const a = animationOf()
  const clips = fn(a.camera?.clips ?? [])
  if (!clips) return false
  const home = a.camera?.home ?? currentView()
  if (!home) return false
  const next: AnimationData = { ...a, camera: clips.length ? { home, clips } : null }
  apply(next, live)
  return true
}

/** Puts a camera block on the camera's row: where asked if there is room there, else the nearest room. */
export function addCamClip(type: CamType, at?: number, length = CAMS[type].duration): void {
  if (useAnim.getState().playing) pause()
  const clips = animationOf().camera?.clips ?? []
  const end = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const spot = placeClip(clips, { start: at ?? end, duration: length })
  if (!spot) {
    say('There is no room for that block there.')
    return
  }
  const selected = useStore.getState().selectedId
  const sel = useStore.getState().objects.find((o) => o.id === selected)
  const clip: CamClip = {
    id: crypto.randomUUID(),
    type,
    start: round3(spot.start),
    duration: round3(spot.duration),
    // Frames the character picked in the scene, if one is.
    subject: sel && canWalk(sel) ? sel.id : null
  }
  if (editCamera((c) => [...c, clip])) selectClip({ objectId: CAMERA, clipId: clip.id })
}

export function moveCamClip(clipId: string, start: number, live = false): void {
  editCamera((clips) => {
    const c = clips.find((x) => x.id === clipId)
    const spot =
      c &&
      placeClip(
        clips.filter((x) => x !== c),
        { start, duration: c.duration },
        c.duration
      )
    if (!c || !spot || Math.abs(spot.start - c.start) < 1e-4) return null
    return clips.map((x) => (x === c ? { ...x, start: round3(spot.start) } : x))
  }, live)
}

export function resizeCamClip(clipId: string, edge: 'start' | 'end', t: number, live = false): void {
  editCamera((clips) => {
    const next = resizeClips(clips, clipId, edge, t, MIN_CLIP).map((x) => ({
      ...x,
      start: round3(x.start),
      duration: round3(x.duration)
    }))
    return JSON.stringify(next) === JSON.stringify(clips) ? null : next
  }, live)
}

export function setCamClip(clipId: string, patch: Partial<Omit<CamClip, 'id'>>): void {
  editCamera((clips) => clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)))
}

export function deleteCamClip(clipId: string): void {
  useAnim.setState({ selectedClip: null, selectedPoint: null, addingPoints: false })
  editCamera((clips) => clips.filter((c) => c.id !== clipId))
  if (!animationOf().camera) releaseCamera()
}

/**
 * Called when the viewer lets go of the viewport camera: the camera block that is selected (or the one under the
 * playhead) takes the view, like moving a layer on a Premiere timeline. Returns whether a block took it.
 */
export function adoptViewportView(): boolean {
  const an = useAnim.getState()
  if (an.mode !== 'animation' || an.playing) return false
  const a = animationOf()
  const clips = [...(a.camera?.clips ?? [])].sort((x, y) => x.start - y.start)
  if (!clips.length) return false
  const t = an.time
  const chosen =
    camClipOf(an.selectedClip) ?? clips.find((c) => t >= c.start - 1e-6 && t <= c.start + c.duration + 1e-6)
  const wanted = currentView()
  if (!chosen || !wanted) return false
  const at = Math.min(chosen.start + chosen.duration, Math.max(chosen.start, t))
  const view = startFor(chosen, wanted, at, subjectAt)
  const first = clips[0].id === chosen.id
  const home = first ? view : (a.camera?.home ?? view)
  commit({ ...a, camera: { home, clips: a.camera!.clips.map((c) => (c.id === chosen.id ? { ...c, view } : c)) } })
  showFrame()
  say(first ? 'The camera block now starts from this view.' : 'This block now starts from this view.')
  return true
}

/** Lets a block start where the one before it ended again. */
export function followPrevious(clipId: string): void {
  editCamera((clips) =>
    clips.map((c) => {
      if (c.id !== clipId) return c
      const { view: _view, ...rest } = c
      return rest
    })
  )
}

/** Makes the viewport's camera as it is now the view the first block starts from. */
export function setCameraHome(): void {
  const a = animationOf()
  const home = currentView()
  if (!a.camera || !home) return
  // The view you see is the lane's own while a block covers the playhead; the start is what the camera looked like
  // before any block, so step off the lane first.
  commit({ ...a, camera: { ...a.camera, home } })
  say('The camera lane now starts from this view.')
}

// ------------------------------------------------------------------ scene tracks

const sceneOf = (): SceneTrack[] => animationOf().scene ?? []

/** The scene's own numbers (sun, look, focus, object opacity) at time `t`. */
function driveWorld(t: number): void {
  if (useAnim.getState().mode !== 'animation') return
  driveScene(sceneOf(), t, write)
  driveReveal(sceneOf(), t)
}

// Build-up: a model comes up from the ground by a horizontal clip that rises through it.
const revealed = new Map<string, THREE.Plane>()
const boundsOf = new Map<string, { lo: number; hi: number }>()

function setClip(id: string, plane: THREE.Plane | null): void {
  const obj = viewport.objects.get(id)
  if (!obj) return
  obj.traverse((x) => {
    const mesh = x as THREE.Mesh
    if (!mesh.isMesh || x.userData.helper) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const had = !!m.clippingPlanes?.length
      m.clippingPlanes = plane ? [plane] : []
      if (had !== !!plane) m.needsUpdate = true
    }
  })
}

function driveReveal(tracks: SceneTrack[], t: number): void {
  const live = new Set<string>()
  for (const tr of tracks) {
    if (tr.prop !== 'reveal' || !tr.objectId) continue
    const v = sampleScene(tr, t)
    const obj = viewport.objects.get(tr.objectId)
    if (v === null || !obj) continue
    live.add(tr.objectId)
    let b = boundsOf.get(tr.objectId)
    if (!b) {
      const box = new THREE.Box3().setFromObject(obj)
      b = { lo: box.min.y, hi: box.max.y }
      boundsOf.set(tr.objectId, b)
    }
    let plane = revealed.get(tr.objectId)
    if (v >= 0.999) {
      if (plane) setClip(tr.objectId, null)
      revealed.delete(tr.objectId)
      continue
    }
    if (!plane) {
      plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
      revealed.set(tr.objectId, plane)
      setClip(tr.objectId, plane)
    }
    plane.constant = b.lo + Math.max(0, v) * (b.hi - b.lo)
  }
  releaseReveal(live)
}

function releaseReveal(keep: Set<string>): void {
  for (const id of [...revealed.keys()]) {
    if (keep.has(id)) continue
    setClip(id, null)
    revealed.delete(id)
    boundsOf.delete(id)
  }
}

function editScene(fn: (tracks: SceneTrack[]) => SceneTrack[], live = false): void {
  apply({ ...animationOf(), scene: fn(sceneOf()) }, live)
}

/** A track for a property (and an object, for object properties), with a first key at the playhead. */
export function addSceneTrack(prop: ScenePropId, objectId?: string): string | null {
  const d = SCENE_PROPS[prop]
  const obj = objectId ? useStore.getState().objects.find((o) => o.id === objectId) : undefined
  if (d.target === 'object' && (!obj || !fitsKind(prop, obj.kind))) {
    say(`Pick ${d.label === 'Visible' ? 'something' : 'an object that has it'} in the scene first.`)
    return null
  }
  const old = sceneOf().find((t) => t.prop === prop && t.objectId === objectId)
  if (old) return old.id
  const tr: SceneTrack = { id: crypto.randomUUID(), prop, objectId, keys: [] }
  tr.keys = [{ t: round3(useAnim.getState().time), v: sceneValue(tr) }]
  editScene((t) => [...t, tr])
  return tr.id
}

/** Title and text effects in one click: the text pops in, types itself out, or counts up, starting at the playhead. */
export function addTextEffect(kind: 'pop' | 'typewriter' | 'counter', objectId: string): void {
  const o = useStore.getState().objects.find((x) => x.id === objectId)
  if (!o || (o.kind !== 'text' && o.kind !== 'pixelText')) {
    say('Select a title or a pixel text in the scene first.')
    return
  }
  const t0 = round3(useAnim.getState().time)
  const full = o.text.replace(/\s/g, '').length
  const [prop, keys] = (
    kind === 'pop'
      ? [
          'size',
          [
            [0, 0.01],
            [0.22, 1.18],
            [0.4, 0.96],
            [0.55, 1]
          ]
        ]
      : kind === 'typewriter'
        ? [
            'typed',
            [
              [0, 0],
              [Math.min(4, Math.max(1, full * 0.07)), 1]
            ]
          ]
        : [
            'count',
            [
              [0, 0],
              [2, Number(o.text) || 100]
            ]
          ]
  ) as [ScenePropId, [number, number][]]
  // Size keys are relative to the size it has now.
  const base = prop === 'size' ? o.scale : 1
  inBatch(() => {
    const id = addSceneTrack(prop, objectId)
    if (!id) return
    editScene((ts) =>
      ts.map((x) =>
        x.id === id ? { ...x, keys: keys.map(([dt, v]) => ({ t: round3(t0 + dt), v: round3(v * base) })) } : x
      )
    )
  })
}

export function removeSceneTrack(id: string): void {
  editScene((t) => t.filter((x) => x.id !== id))
  syncTracks()
}

/** Sets the property to `v` at the playhead: puts a key there (or changes the one that is). */
export function setSceneValue(id: string, v: number, live = false): void {
  const time = round3(useAnim.getState().time)
  editScene(
    (ts) =>
      ts.map((x) => (x.id === id ? { ...x, keys: putSceneKey(x.keys, { t: time, v: clampScene(x.prop, v) }) } : x)),
    live
  )
}

export function moveSceneKey(id: string, from: number, to: number, live = false): void {
  editScene(
    (ts) =>
      ts.map((x) => {
        if (x.id !== id) return x
        const k = x.keys.find((q) => Math.abs(q.t - from) < 1e-3)
        if (!k) return x
        return {
          ...x,
          keys: putSceneKey(
            x.keys.filter((q) => q !== k),
            { t: round3(Math.max(0, to)), v: k.v }
          )
        }
      }),
    live
  )
}

export function removeSceneKey(id: string, t: number): void {
  editScene((ts) => ts.map((x) => (x.id === id ? { ...x, keys: x.keys.filter((k) => Math.abs(k.t - t) > 1e-3) } : x)))
}

/** The value a track shows at the playhead. */
export const sceneAt = (tr: SceneTrack, t = useAnim.getState().time): number => sampleScene(tr, t) ?? 0

/** Where something is on the screen (0…1 across and down) as the camera sees it at time `t`. */
function screenPoint(at: Vec3, t: number): { x: number; y: number } | null {
  const cam = viewport.camera
  if (!cam) return null
  const view = animationOf().camera?.clips.length ? cameraAt(planOf(), t, subjectAt) : null
  const c = view ?? {
    position: cameraBridge.get?.()?.position ?? ([0, 0, 0] as Vec3),
    target: cameraBridge.get?.()?.target ?? ([0, 0, 1] as Vec3),
    fov: cam.fov
  }
  const probe = new THREE.PerspectiveCamera(c.fov, cam.aspect, 0.1, 1000)
  probe.position.set(...c.position)
  probe.lookAt(new THREE.Vector3(...c.target))
  probe.updateMatrixWorld(true)
  const p = new THREE.Vector3(...at).project(probe)
  if (p.z > 1) return null
  return { x: Math.min(1, Math.max(0, (p.x + 1) / 2)), y: Math.min(1, Math.max(0, (1 - p.y) / 2)) }
}

/** Focus pulls from one character to another: the focus point rides from where the first is to where the second is. */
export function rackFocus(fromId: string, toId: string, at = useAnim.getState().time, duration = 1.2): void {
  const s = useStore.getState()
  const chest = (id: string, t: number): { x: number; y: number } | null => {
    const sub = subjectAt(id, t)
    const o = s.objects.find((x) => x.id === id)
    const pos = sub?.position ?? o?.position
    if (!pos) return null
    return screenPoint([pos[0], pos[1] + 1.1 * (o && 'scale' in o ? o.scale || 1 : 1), pos[2]], t)
  }
  const a = chest(fromId, at)
  const b = chest(toId, at + duration)
  if (!a || !b) {
    say('Both characters need to be in the scene, and in front of the camera, to pull focus between them.')
    return
  }
  const t0 = round3(at)
  const t1 = round3(at + duration)
  inBatch(() => {
    for (const [prop, from, to] of [
      ['focusX', a.x, b.x],
      ['focusY', a.y, b.y]
    ] as const) {
      const id = addSceneTrack(prop)
      if (!id) continue
      editScene((ts) =>
        ts.map((x) =>
          x.id === id
            ? {
                ...x,
                keys: putSceneKey(
                  putSceneKey(
                    x.keys.filter((k) => k.t < t0 - 1e-3 || k.t > t1 + 1e-3),
                    { t: t0, v: from }
                  ),
                  {
                    t: t1,
                    v: to
                  }
                )
              }
            : x
        )
      )
    }
  })
}

export type { SceneKey }
export { propDef as scenePropDef }

// ------------------------------------------------------------------ export reframing

/**
 * For a video cut to a narrower frame than the scene (Shorts, Reels): slides the camera sideways every frame so the
 * character stays in the middle of the picture. The slide is worked out for the whole animation first and smoothed,
 * so the picture follows without jitter. `at(i, t)` puts the camera for frame `i` (call it after the frame's poses).
 */
export function makeReframer(
  subject: string,
  frames: number,
  fps: number,
  aspect: number
): { at: (i: number) => void; end: () => void } {
  const cam = viewport.camera
  const start = cameraBridge.get?.() ?? null
  const view = (): { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null => {
    const c = cameraBridge.get?.()
    return c && cam
      ? { position: new THREE.Vector3(...c.position), target: new THREE.Vector3(...c.target), fov: cam.fov }
      : null
  }
  // The camera before any sliding, per frame: driven by the camera blocks, or where it stood.
  const base: ({ position: THREE.Vector3; target: THREE.Vector3 } | null)[] = []
  const raw: number[] = []
  for (let i = 0; i < frames; i++) {
    posesAt(i / fps)
    const v = view()
    const sub = subjectAt(subject, i / fps)
    base.push(v && { position: v.position.clone(), target: v.target.clone() })
    if (!v || !sub) {
      raw.push(0)
      continue
    }
    const dir = v.target.clone().sub(v.position).normalize()
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    const rel = new THREE.Vector3(sub.position[0], sub.position[1] + 1, sub.position[2]).sub(v.position)
    raw.push(rel.dot(right))
  }
  // A moving average over about a second, so the slide eases rather than twitches.
  const half = Math.max(1, Math.round(fps * 0.5))
  const shift = raw.map((_, i) => {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(frames - 1, i + half); j++) {
      sum += raw[j]
      n++
    }
    return sum / n
  })
  void aspect
  return {
    at: (i) => {
      const b = base[i]
      if (!b) return
      const dir = b.target.clone().sub(b.position).normalize()
      const right = new THREE.Vector3()
        .crossVectors(dir, new THREE.Vector3(0, 1, 0))
        .normalize()
        .multiplyScalar(shift[i])
      const p = b.position.clone().add(right)
      const t = b.target.clone().add(right)
      cameraBridge.set?.({ position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] })
    },
    end: () => {
      if (start) cameraBridge.set?.(start)
    }
  }
}

// ------------------------------------------------------------------ suggestions

export interface Suggestion {
  id: string
  label: string
  run: () => void
}

const USES: [RegExp, string][] = [
  [/chest|barrel|crate|shulker|door|gate|trapdoor/i, 'Open'],
  [/lever|button|switch|bell/i, 'Press'],
  [/sign|book|lectern|banner/i, 'Read'],
  [/table|furnace|anvil|smithing|loom|stonecutter|grindstone|cauldron|brewing|enchant/i, 'Use'],
  [/torch|lantern|candle|campfire/i, 'Touch']
]

/**
 * What a character could do about what is near it at the playhead: open the chest it stands by, wave at or look at a
 * character close by, walk over to something. Each is one click and plain blocks on the timeline.
 */
export function suggestionsFor(id: string, t = useAnim.getState().time): Suggestion[] {
  const s = useStore.getState()
  const me = s.objects.find((o) => o.id === id)
  const at = subjectAt(id, t)
  if (!me || !canWalk(me) || !at) return []
  const out: Suggestion[] = []
  const near = s.objects
    .filter((o) => o.id !== id && o.visible && o.kind !== 'terrain' && o.kind !== 'image' && o.kind !== 'sticker')
    .map((o) => ({ o, d: Math.hypot(o.position[0] - at.position[0], o.position[2] - at.position[2]) }))
    .filter((x) => x.d < 7)
    .sort((a, b) => a.d - b.d)
  for (const { o, d } of near.slice(0, 6)) {
    if (canWalk(o)) {
      out.push({
        id: `wave:${o.id}`,
        label: `Wave at ${o.name}`,
        run: () =>
          inBatch(() => {
            addClip(id, 'wave', undefined, canLayer('wave') && me.kind === 'player' ? 'upper' : undefined)
            if (me.kind === 'player') setLook(id, { target: o.id, amount: 1 })
          })
      })
      continue
    }
    const use = USES.find(([re]) => re.test(o.name))
    if (use && d < 4)
      out.push({
        id: `use:${o.id}`,
        label: `${use[1]} ${o.name}`,
        run: () =>
          draftFromText(`${me.name} walks to the ${o.name}, ${use[1] === 'Use' ? 'touches' : 'opens'} the ${o.name}`)
      })
    else if (d > 2)
      out.push({ id: `go:${o.id}`, label: `Walk to ${o.name}`, run: () => void goTo(id, o.position as Vec3) })
  }
  return out
}

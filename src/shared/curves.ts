// Curves: every number in a key as a channel (where it is, how it is turned, each joint's angle, each mob part's
// angle), for drawing as a graph and editing by hand.
import type { AnimKey, AnimTrack } from './animation'
import { fullPose, PART_NAMES, type PartName } from './minecraft/playerModel'

export interface Channel {
  /** `pos.1`, `rot.1`, `pose.rightArm.0`, `part.right_arm.2`. */
  id: string
  label: string
  group: 'Move' | 'Turn' | 'Joint' | 'Part'
  /** Degrees or blocks. */
  unit: 'deg' | 'blocks'
}

const AXES = ['across', 'up', 'ahead']
const TURN = ['tip', 'turn', 'lean']
const AXIS3 = ['x', 'y', 'z']
const JOINT: Record<PartName, string> = {
  head: 'Head',
  body: 'Body',
  rightArm: 'Right arm',
  rightForearm: 'Right forearm',
  leftArm: 'Left arm',
  leftForearm: 'Left forearm',
  rightLeg: 'Right leg',
  rightShin: 'Right shin',
  leftLeg: 'Left leg',
  leftShin: 'Left shin'
}

export function channelsOf(track: Pick<AnimTrack, 'keys'>): Channel[] {
  const out: Channel[] = [
    ...AXES.map((a, i): Channel => ({ id: `pos.${i}`, label: `Position ${a}`, group: 'Move', unit: 'blocks' })),
    ...TURN.map((a, i): Channel => ({ id: `rot.${i}`, label: `Rotation ${a}`, group: 'Turn', unit: 'deg' }))
  ]
  if (track.keys.some((k) => k.pose))
    for (const p of PART_NAMES)
      for (let i = 0; i < 3; i++)
        out.push({ id: `pose.${p}.${i}`, label: `${JOINT[p]} ${AXIS3[i]}`, group: 'Joint', unit: 'deg' })
  const parts = new Set<string>()
  for (const k of track.keys) for (const n of Object.keys(k.parts ?? {})) parts.add(n)
  for (const n of [...parts].sort())
    for (let i = 0; i < 3; i++)
      out.push({ id: `part.${n}.${i}`, label: `${n.split('/').pop()} ${AXIS3[i]}`, group: 'Part', unit: 'deg' })
  return out
}

type Keyish = Pick<AnimKey, 'position' | 'rotation' | 'pose' | 'parts'>

const parse = (id: string): { kind: string; name: string; axis: number } | null => {
  const bits = id.split('.')
  const axis = Number(bits.at(-1))
  if (!Number.isInteger(axis) || axis < 0 || axis > 2) return null
  return { kind: bits[0], name: bits.slice(1, -1).join('.'), axis }
}

/** What a key holds in a channel (null when it has none). */
export function channelValue(k: Keyish, id: string): number | null {
  const c = parse(id)
  if (!c) return null
  if (c.kind === 'pos') return k.position[c.axis]
  if (c.kind === 'rot') return k.rotation[c.axis]
  if (c.kind === 'pose') return k.pose ? fullPose(k.pose)[c.name as PartName]?.[c.axis] : null
  if (c.kind === 'part') return k.parts?.[c.name]?.[c.axis] ?? 0
  return null
}

/** The key with one channel set. */
export function withChannel<K extends Keyish>(k: K, id: string, v: number): K {
  const c = parse(id)
  if (!c || !Number.isFinite(v)) return k
  const r = Math.round(v * 1000) / 1000
  const set = (a: [number, number, number]): [number, number, number] =>
    a.map((x, i) => (i === c.axis ? r : x)) as [number, number, number]
  if (c.kind === 'pos') return { ...k, position: set(k.position) }
  if (c.kind === 'rot') return { ...k, rotation: set(k.rotation) }
  if (c.kind === 'pose' && k.pose) {
    const pose = fullPose(k.pose)
    const name = c.name as PartName
    return pose[name] ? { ...k, pose: { ...pose, [name]: set(pose[name]) } } : k
  }
  if (c.kind === 'part') return { ...k, parts: { ...k.parts, [c.name]: set(k.parts?.[c.name] ?? [0, 0, 0]) } }
  return k
}

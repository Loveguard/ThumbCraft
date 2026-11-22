import { describe, expect, it } from 'vitest'
import { CLIPS, CLIP_ORDER, compileClips, sampleTrack, yawOfRotation, type Clip } from '@shared/animation'
import { cameraAt, planCamera, type CamClip } from '@shared/camera'
import { fullPose, type Pose } from '@shared/minecraft/playerModel'
import { ACTION_GROUPS } from '@shared/animation'

const who = {
  kind: 'player' as const,
  scale: 1,
  rotation: [0, 0, 0] as [number, number, number],
  pose: fullPose(undefined),
  position: [0, 0, 0] as [number, number, number]
}
const at = (clips: Clip[], t: number): ReturnType<typeof sampleTrack> =>
  sampleTrack({ objectId: 'x', keys: compileClips(clips, who).keys }, t)

describe('Pose blocks', () => {
  const pose: Pose = { ...fullPose(undefined), rightArm: [-150, 0, 0], head: [20, 0, 0] }
  it('go into the pose and hold it for the whole block', () => {
    const clips: Clip[] = [{ id: 'p', type: 'pose', start: 0, duration: 3, pose }]
    for (const t of [0.8, 1.5, 2.4]) {
      const st = at(clips, t)!
      expect(st.pose!.rightArm[0]).toBeCloseTo(-150, 0)
      expect(st.pose!.head[0]).toBeCloseTo(20, 0)
    }
    // And come back out of it at the end.
    expect(at(clips, 3)!.pose!.rightArm[0]).toBeCloseTo(0, 0)
  })
  it('keep the legs to the walk under them on the arms and head row', () => {
    const legs: Pose = { ...pose, rightLeg: [-60, 0, 0] }
    const clips: Clip[] = [
      { id: 'w', type: 'walk', start: 0, duration: 4, path: [[0, 0, 6]] },
      { id: 'p', type: 'pose', start: 1, duration: 2, pose: legs, layer: 'upper' }
    ]
    const st = at(clips, 2)!
    expect(st.pose!.rightArm[0]).toBeCloseTo(-150, 0)
    expect(Math.abs(st.pose!.rightLeg[0] + 60)).toBeGreaterThan(5)
  })
})

describe('Easing', () => {
  it('snappy gets into the action sooner than gentle', () => {
    const point = (ease: Clip['ease']): number =>
      Math.abs(at([{ id: 'a', type: 'point', start: 0, duration: 3, ease }], 0.08)!.pose!.rightArm[0])
    expect(point('snappy')).toBeGreaterThan(point('smooth'))
    expect(point('smooth')).toBeGreaterThan(point('gentle'))
  })
})

describe('Lunge and spin', () => {
  it('a lunge goes forward and comes back', () => {
    const clips: Clip[] = [{ id: 'l', type: 'lunge', start: 0, duration: 1.2 }]
    expect(at(clips, 0.42)!.position[2]).toBeGreaterThan(0.5)
    expect(at(clips, 1.2)!.position[2]).toBeCloseTo(0, 2)
  })
  it('a spin turns round and ends facing the same way', () => {
    const clips: Clip[] = [{ id: 's', type: 'spin', start: 0, duration: 1.5 }]
    expect(Math.cos(yawOfRotation(at(clips, 0.75)!.rotation))).toBeLessThan(-0.9)
    expect(Math.cos(yawOfRotation(at(clips, 1.5)!.rotation))).toBeGreaterThan(0.999)
  })
  it('work on mobs too', () => {
    expect(CLIPS.lunge.playersOnly).toBe(false)
    expect(CLIPS.spin.playersOnly).toBe(false)
  })
})

describe('Glide camera blocks', () => {
  const home = {
    position: [0, 3, -8] as [number, number, number],
    target: [0, 1, 0] as [number, number, number],
    fov: 70
  }
  const to = { position: [6, 2, 0] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 50 }
  const clips: CamClip[] = [
    { id: 'a', type: 'hold', start: 0, duration: 1, view: home },
    { id: 'b', type: 'glide', start: 1, duration: 2, to }
  ]
  const plan = planCamera({ home, clips }, () => null)
  it('move from the shot before to the one set', () => {
    expect(cameraAt(plan, 1, () => null)!.position).toEqual(home.position)
    const mid = cameraAt(plan, 2, () => null)!
    expect(mid.position[0]).toBeCloseTo(3, 5)
    expect(mid.fov).toBeCloseTo(60, 5)
    expect(cameraAt(plan, 3, () => null)!.position).toEqual(to.position)
  })
})

describe('The Animate panel lists', () => {
  it('every action exactly once', () => {
    const listed = ACTION_GROUPS.flatMap(([, types]) => types)
    const actions = CLIP_ORDER.filter((t) => !CLIPS[t].moves)
    expect([...listed].sort()).toEqual([...actions].sort())
  })
})

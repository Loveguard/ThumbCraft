import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  CLIPS,
  CLIP_ORDER,
  GAITS,
  MIN_CLIP,
  gaitForSpeed,
  modeOf,
  compileClips,
  placeClip,
  resizeClip,
  type Clip,
  type ClipType,
  PathCurve,
  footDrop,
  humanoidOf,
  partsFromPose,
  gaitPose,
  mobLimbs,
  putKey,
  sampleTrack,
  strideOf,
  walkKeys,
  type AnimKey
} from '@shared/animation'
import { POSES, fullPose } from '@shared/minecraft/playerModel'

const key = (t: number, x: number, yaw = 0): AnimKey => ({ t, position: [x, 0, 0], rotation: [0, yaw, 0] })

describe('sampleTrack', () => {
  it('passes through every key and holds before and after', () => {
    const track = { objectId: 'a', keys: [key(0, 0), key(1, 2), key(2, 3)] }
    expect(sampleTrack(track, -1)!.position[0]).toBe(0)
    expect(sampleTrack(track, 1)!.position[0]).toBeCloseTo(2)
    expect(sampleTrack(track, 5)!.position[0]).toBe(3)
  })
  it('eases out of the first key and into the last', () => {
    const track = { objectId: 'a', keys: [key(0, 0), key(1, 1)] }
    expect(sampleTrack(track, 0.5)!.position[0]).toBeCloseTo(0.5)
    expect(sampleTrack(track, 0.1)!.position[0]).toBeLessThan(0.1)
  })
  it('turns the short way round across ±180°', () => {
    const track = { objectId: 'a', keys: [key(0, 0, 170), key(1, 0, -170)] }
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(sampleTrack(track, 0.5)!.quaternion)
    // Halfway between 170° and 190° is 180°: facing -Z.
    expect(forward.z).toBeCloseTo(-1, 3)
    expect(Math.abs(forward.x)).toBeLessThan(1e-3)
  })
})

describe('putKey', () => {
  it('replaces a key at the same time and keeps them sorted', () => {
    const keys = putKey(putKey([key(1, 1), key(0, 0)], key(0.5, 9)), key(1, 7))
    expect(keys.map((k) => [k.t, k.position[0]])).toEqual([
      [0, 0],
      [0.5, 9],
      [1, 7]
    ])
  })
})

describe('PathCurve', () => {
  it('measures a straight path and faces along it', () => {
    const c = new PathCurve([
      [0, 0, 0],
      [0, 0, 10]
    ])
    expect(c.length).toBeCloseTo(10, 3)
    expect(c.yawAt(5)).toBeCloseTo(0)
    expect(
      new PathCurve([
        [0, 0, 0],
        [10, 0, 0]
      ]).yawAt(5)
    ).toBeCloseTo(Math.PI / 2)
  })
})

describe('gaits', () => {
  it('swings arms against legs, forward being negative', () => {
    const p = gaitPose(GAITS.walk, Math.PI / 2, 1, POSES.Standing)
    expect(p.rightLeg[0]).toBeLessThan(0) // right leg forward
    expect(p.rightArm[0]).toBeGreaterThan(0) // right arm back
    expect(p.leftArm[0]).toBeLessThan(0)
    expect(p.rightShin[0]).toBeGreaterThanOrEqual(0) // knees only bend backwards
  })
  it('stands as posed at zero amount', () => {
    expect(gaitPose(GAITS.run, 1.2, 0, POSES.Pointing)).toEqual(POSES.Pointing)
  })
  it('drops the body so a planted foot touches the ground', () => {
    expect(footDrop(POSES.Standing)).toBeCloseTo(0)
    expect(footDrop(gaitPose(GAITS.walk, Math.PI / 2, 1, POSES.Standing))).toBeGreaterThan(0)
  })
})

describe('walkKeys', () => {
  const path = {
    points: [
      [0, 64, 0],
      [0, 64, 6],
      [6, 64, 12]
    ] as [number, number, number][],
    gait: 'walk' as const,
    speed: 1,
    start: 0.5
  }
  const keys = walkKeys(path, { kind: 'player', scale: 1, rotation: [0, 0, 0], pose: POSES.Standing })

  it('starts at the start, ends at the end, standing still both times', () => {
    expect(keys[0].t).toBe(0.5)
    expect(keys[0].position).toEqual([0, 64, 0])
    expect(keys.at(-1)!.position[0]).toBeCloseTo(6, 1)
    expect(keys.at(-1)!.position[2]).toBeCloseTo(12, 1)
    expect(keys.at(-1)!.pose!.rightLeg[0]).toBeCloseTo(0)
  })
  it('takes about as long as the path at walking speed', () => {
    const length = new PathCurve(path.points).length
    const time = keys.at(-1)!.t - 0.5
    expect(time).toBeGreaterThan(length / GAITS.walk.speed)
    expect(time).toBeLessThan(length / GAITS.walk.speed + GAITS.walk.accel * 1.5)
  })
  it('puts a key on every quarter step', () => {
    const length = new PathCurve(path.points).length
    expect(keys.length).toBeGreaterThanOrEqual(Math.floor((4 * length) / strideOf(GAITS.walk)))
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t)
  })
  it('ends facing the way the path goes (north-east here)', () => {
    expect(keys.at(-1)!.rotation[1]).toBeGreaterThan(30)
    expect(keys.at(-1)!.rotation[1]).toBeLessThan(60)
  })
  it('never moves backwards along a straight path', () => {
    const straight = walkKeys(
      {
        ...path,
        points: [
          [0, 0, 0],
          [0, 0, 8]
        ],
        gait: 'sprint'
      },
      {
        kind: 'player',
        scale: 1,
        rotation: [0, 0, 0],
        pose: POSES.Standing
      }
    )
    const track = { objectId: 'a', keys: straight }
    let last = -1
    for (let t = 0; t < straight.at(-1)!.t; t += 1 / 30) {
      const z = sampleTrack(track, t)!.position[2]
      expect(z).toBeGreaterThanOrEqual(last - 0.02)
      last = z
    }
  })
  it('handles a path too short to reach full speed', () => {
    const short = walkKeys(
      {
        ...path,
        points: [
          [0, 0, 0],
          [0, 0, 0.5]
        ],
        gait: 'sprint'
      },
      { kind: 'mob', scale: 1, rotation: [0, 0, 0] }
    )
    expect(short.at(-1)!.position[2]).toBeCloseTo(0.5, 2)
    expect(short.every((k) => Number.isFinite(k.t))).toBe(true)
  })
})

describe('mobLimbs', () => {
  it('times a quadruped like the game: diagonal pairs together', () => {
    const limbs = mobLimbs(['head', 'body', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg'])
    const off = Object.fromEntries(limbs.map((l) => [l.path, l.offset % (2 * Math.PI)]))
    expect(limbs).toHaveLength(4)
    expect(off.right_hind_leg).toBeCloseTo(off.left_front_leg)
    expect(off.left_hind_leg).toBeCloseTo(off.right_front_leg)
    expect(Math.abs(off.right_hind_leg - off.left_hind_leg)).toBeCloseTo(Math.PI)
  })
})

describe('blocks on the timeline', () => {
  const who = {
    kind: 'player' as const,
    scale: 1,
    rotation: [0, 0, 0] as [number, number, number],
    pose: POSES.Standing,
    position: [0, 0, 0] as [number, number, number]
  }
  const clip = (
    id: string,
    type: Clip['type'],
    start: number,
    duration: number,
    path?: [number, number, number][]
  ): Clip => ({ id, type, start, duration, path })

  it('places a block in the nearest free gap and shortens it to fit', () => {
    const others = [clip('a', 'walk', 0, 2), clip('b', 'idle', 3, 2)]
    expect(placeClip(others, { start: 1, duration: 1 })).toEqual({ start: 2, duration: 1 })
    expect(placeClip(others, { start: 2.2, duration: 3 })).toEqual({ start: 2, duration: 1 })
    expect(placeClip(others, { start: 9, duration: 2 })).toEqual({ start: 9, duration: 2 })
    expect(placeClip([clip('a', 'walk', 0.2, 2)], { start: 0, duration: 1 })).toEqual({ start: 2.2, duration: 1 })
  })

  it('resizes a block up to its neighbours and no shorter than the minimum', () => {
    const list = [clip('a', 'walk', 0, 2), clip('b', 'idle', 3, 2)]
    expect(resizeClip(list, 'a', 'end', 9)[0].duration).toBe(3)
    expect(resizeClip(list, 'b', 'start', 0)[1].start).toBe(2)
    expect(resizeClip(list, 'b', 'start', 4.9)[1].duration).toBeCloseTo(MIN_CLIP)
  })

  it('takes exactly as long as its block, and goes where its path goes', () => {
    const { keys } = compileClips([clip('w', 'walk', 1, 4, [[0, 0, 8]])], who)
    expect(keys.at(-1)!.t).toBeCloseTo(5)
    expect(keys.at(-1)!.position[2]).toBeCloseTo(8, 1)
    // Standing still until it sets off.
    expect(sampleTrack({ objectId: 'x', keys }, 0.5)!.position[2]).toBeCloseTo(0, 1)
  })

  it('carries blocks that touch through each other without a stop or a jump', () => {
    const { keys } = compileClips([clip('a', 'walk', 0, 3, [[0, 0, 5]]), clip('b', 'walk', 3, 3, [[4, 0, 9]])], who)
    const track = { objectId: 'x', keys }
    const before = sampleTrack(track, 2.99)!
    const after = sampleTrack(track, 3.01)!
    expect(Math.hypot(...(before.position.map((v, i) => v - after.position[i]) as number[]))).toBeLessThan(0.15)
    // Still moving at the join: halfway through the first second of the second block it is well on its way.
    expect(sampleTrack(track, 3.5)!.position[2]).toBeGreaterThan(before.position[2] + 0.4)
    for (const n of ['rightLeg', 'rightArm', 'leftShin'] as const)
      expect(Math.abs(before.pose![n][0] - after.pose![n][0])).toBeLessThan(15)
  })

  it('starts the next block where the last one stopped', () => {
    const { keys, starts } = compileClips(
      [clip('a', 'walk', 0, 3, [[0, 0, 5]]), clip('p', 'point', 3, 2), clip('b', 'run', 5, 2, [[5, 0, 5]])],
      who
    )
    expect(starts.b[2]).toBeCloseTo(5, 1)
    expect(keys.at(-1)!.position[0]).toBeCloseTo(5, 1)
  })

  it('eases an action in from and out to the rest pose', () => {
    const { keys } = compileClips([clip('p', 'point', 1, 2)], who)
    const track = { objectId: 'x', keys }
    expect(sampleTrack(track, 1)!.pose!.rightArm[0]).toBeCloseTo(0, 0)
    expect(sampleTrack(track, 2)!.pose!.rightArm[0]).toBeLessThan(-80)
    expect(sampleTrack(track, 3)!.pose!.rightArm[0]).toBeCloseTo(0, 0)
  })

  it('jumps up and lands where it took off', () => {
    const { keys } = compileClips([clip('j', 'jump', 0, 1.2)], who)
    const track = { objectId: 'x', keys }
    const top = Math.max(...keys.map((k) => k.position[1]))
    expect(top).toBeGreaterThan(0.9)
    expect(sampleTrack(track, 1.2)!.position[1]).toBeCloseTo(0, 2)
    expect(sampleTrack(track, 0)!.position).toEqual([0, 0, 0])
  })

  it('breaks a walk into a run when its length asks for more speed', () => {
    const far: [number, number, number][] = [[0, 0, 20]]
    const slow = compileClips([clip('a', 'walk', 0, 8, far)], who)
    const quick = compileClips([clip('a', 'walk', 0, 4, far)], who)
    const sprint = compileClips([clip('a', 'walk', 0, 2.8, far)], who)
    expect([slow.gaits.a, quick.gaits.a, sprint.gaits.a]).toEqual(['walk', 'run', 'sprint'])
    expect(compileClips([{ ...clip('a', 'walk', 0, 4, far), auto: false }], who).gaits.a).toBe('walk')
    expect(gaitForSpeed(2)).toBe('walk')
  })

  it('every action starts and ends on the rest pose, in every mode, and stays finite', () => {
    for (const type of CLIP_ORDER) {
      const def = CLIPS[type]
      if (def.moves) continue
      for (const mode of def.modes) {
        const c: Clip = { ...clip('x', type, 0, 2.6), mode }
        expect(modeOf(c)).toBe(mode)
        const { keys } = compileClips([c], who)
        for (const k of keys) {
          expect(k.position.every(Number.isFinite)).toBe(true)
          for (const v of Object.values(k.pose!)) expect(v.every(Number.isFinite)).toBe(true)
        }
        const track = { objectId: 'x', keys }
        for (const t of [0, 2.6]) {
          const p = sampleTrack(track, t)!
          expect(p.position[1]).toBeCloseTo(0, 1)
          expect(p.pose!.rightArm[0]).toBeCloseTo(POSES.Standing.rightArm[0], 0)
        }
      }
    }
  })

  it('loops an action and holds a pose', () => {
    const nod = compileClips([{ ...clip('n', 'nod', 0, 3.6), mode: 'loop' }], who)
    const heads = nod.keys.map((k) => k.pose!.head[0])
    // Three nods of 1.2 s, each two dips of the head.
    expect(
      heads.filter((v, i) => i > 0 && i < heads.length - 1 && v > heads[i - 1] && v >= heads[i + 1] && v > 20).length
    ).toBeGreaterThanOrEqual(5)
    const bow = compileClips([{ ...clip('b', 'bow', 0, 4), mode: 'hold' }], who)
    const track = { objectId: 'x', keys: bow.keys }
    expect(sampleTrack(track, 2)!.pose!.body[0]).toBeGreaterThan(35)
    expect(sampleTrack(track, 2.6)!.pose!.body[0]).toBeGreaterThan(35)
  })

  it('lowers a character that sits', () => {
    const { keys } = compileClips([clip('s', 'sit', 0, 3)], who)
    expect(sampleTrack({ objectId: 'x', keys }, 1.5)!.position[1]).toBeLessThan(-0.5)
  })

  it('waves on the upper row while the legs keep walking', () => {
    const walk = clip('w', 'walk', 0, 4, [[0, 0, 6]])
    const wave: Clip = { id: 'v', type: 'wave', start: 1, duration: 2, layer: 'upper' }
    const plain = compileClips([walk], who)
    const mixed = compileClips([walk, wave], who)
    const a = sampleTrack({ objectId: 'x', keys: plain.keys }, 2)!
    const b = sampleTrack({ objectId: 'x', keys: mixed.keys }, 2)!
    expect(b.position[2]).toBeCloseTo(a.position[2], 1)
    expect(b.pose!.rightLeg[0]).toBeCloseTo(a.pose!.rightLeg[0], 0)
    expect(b.pose!.leftArm[0]).toBeLessThan(a.pose!.leftArm[0] - 60)
    // Outside the block the arm swings as it did.
    const c = sampleTrack({ objectId: 'x', keys: mixed.keys }, 3.8)!
    const d = sampleTrack({ objectId: 'x', keys: plain.keys }, 3.8)!
    expect(c.pose!.leftArm[0]).toBeCloseTo(d.pose!.leftArm[0], 0)
  })

  it('ignores the upper row for anything but players', () => {
    const mob = { ...who, kind: 'mob' as const }
    const wave: Clip = { id: 'v', type: 'wave', start: 0, duration: 2, layer: 'upper' }
    expect(() => compileClips([clip('w', 'walk', 0, 2, [[0, 0, 3]]), wave], mob as never)).not.toThrow()
  })
})

describe('swimming, climbing and leaping blocks', () => {
  const who = {
    kind: 'player' as const,
    scale: 1,
    rotation: [0, 0, 0] as [number, number, number],
    pose: POSES.Standing,
    position: [0, 0, 0] as [number, number, number]
  }
  const mk = (type: Clip['type'], duration: number, path: [number, number, number][]): Clip => ({
    id: type,
    type,
    start: 0,
    duration,
    path
  })

  it('swims face down: the body pitches forward and the feet are not pressed to the ground', () => {
    const { keys } = compileClips([mk('swim', 4, [[0, 0, 6]])], who, (p) => p.map((v) => [v[0], 99, v[2]]))
    const mid = sampleTrack({ objectId: 'x', keys }, 2)!
    expect(Math.abs(mid.rotation[0])).toBeGreaterThan(40)
    // The ground callback would have lifted it to 99; swimming never asks.
    expect(mid.position[1]).toBeLessThan(1)
  })

  it('climbs straight up', () => {
    const { keys } = compileClips([mk('climb', 3, [[0, 5, 0]])], who)
    const end = keys.at(-1)!
    expect(end.position[1]).toBeCloseTo(5, 1)
    expect(Math.abs(end.position[0])).toBeLessThan(0.01)
  })

  it('leaps in an arc and lands on the far side', () => {
    const { keys } = compileClips([mk('leap', 1, [[0, 0, 4]])], who)
    const track = { objectId: 'x', keys }
    expect(keys.at(-1)!.position[2]).toBeCloseTo(4, 3)
    expect(sampleTrack(track, 0.5)!.position[1]).toBeGreaterThan(0.8)
    expect(sampleTrack(track, 1)!.position[1]).toBeCloseTo(0, 2)
  })

  it('goes on walking after a leap', () => {
    const { keys } = compileClips(
      [mk('leap', 1, [[0, 0, 4]]), { id: 'w', type: 'walk', start: 1, duration: 2, path: [[0, 0, 9]] }],
      who
    )
    expect(keys.at(-1)!.position[2]).toBeCloseTo(9, 0)
  })
})

describe('more actions', () => {
  const who = {
    kind: 'player' as const,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: 1
  }
  const clip = (type: ClipType, duration = 2): Clip => ({ id: type, type, start: 0, duration })

  it('every new action compiles to keys that end back at rest', () => {
    for (const t of ['punch', 'slash', 'block', 'cheer', 'clap', 'think', 'fall', 'sleep'] as ClipType[]) {
      const { keys } = compileClips([clip(t, t === 'sleep' ? 4 : 2.5)], who)
      expect(keys.length).toBeGreaterThan(10)
      const last = keys[keys.length - 1]
      expect(Math.abs(last.rotation[0])).toBeLessThan(1e-6)
      expect(last.position[1]).toBeCloseTo(0, 2)
    }
  })

  it('lies flat on its back in the middle of a fall and sleep', () => {
    for (const t of ['fall', 'sleep'] as ClipType[]) {
      const dur = t === 'sleep' ? 4 : 3
      const { keys } = compileClips([clip(t, dur)], who)
      const mid = keys.reduce((a, k) => (Math.abs(k.t - dur / 2) < Math.abs(a.t - dur / 2) ? k : a))
      expect(Math.abs(mid.rotation[0])).toBeGreaterThan(80)
      expect(mid.position[1]).toBeGreaterThan(0.15)
    }
  })
})

describe('mobs built like people', () => {
  const paths = ['root', 'head', 'head/hat', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg']
  it('finds the person among the parts, and nothing in a pig', () => {
    expect(humanoidOf(paths)).toMatchObject({ head: 'head', rightArm: 'right_arm', leftLeg: 'left_leg' })
    expect(humanoidOf(['body', 'head', 'right_hind_leg', 'left_hind_leg'])).toBeNull()
  })

  it('carries a pose over: forward stays forward, sideways and turns mirror', () => {
    const h = humanoidOf(paths)!
    const pose = fullPose({ rightArm: [-90, 0, 0], head: [0, 20, 0], leftArm: [0, 0, 30] })
    const parts = partsFromPose(pose, h)
    expect(parts.right_arm[0]).toBeCloseTo(-90, 3)
    expect(parts.head[1]).toBeCloseTo(-20, 3)
    expect(parts.left_arm[2]).toBeCloseTo(-30, 3)
  })

  it('plays an action on a zombie as part rotations, back to its own at the end', () => {
    const base = { right_arm: [3, 0, 0] as [number, number, number] }
    const zombie = {
      kind: 'mob' as const,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: 1,
      parts: base,
      humanoid: humanoidOf(paths)
    }
    const { keys } = compileClips([{ id: 'w', type: 'wave', start: 0, duration: 2, mode: 'once' }], zombie)
    const peak = keys.reduce((a, k) => Math.min(a, k.parts!.left_arm?.[0] ?? 0), 0)
    expect(peak).toBeLessThan(-100)
    const last = keys[keys.length - 1].parts!
    expect(last.right_arm[0]).toBeCloseTo(3, 1)
    expect(last.left_arm[0]).toBeCloseTo(0, 1)
  })
})

describe('actions that run into each other', () => {
  const who = {
    kind: 'player' as const,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: 1
  }
  it('carry the pose across instead of dropping to rest between them', () => {
    const touching = compileClips(
      [
        { id: 'a', type: 'cower', start: 0, duration: 2.5, mode: 'hold' },
        { id: 'b', type: 'nod', start: 2.5, duration: 1.2 }
      ],
      who
    )
    const apart = compileClips(
      [
        { id: 'a', type: 'cower', start: 0, duration: 2.5, mode: 'hold' },
        { id: 'b', type: 'nod', start: 2.6, duration: 1.2 }
      ],
      who
    )
    const at = (r: ReturnType<typeof compileClips>, t: number): number =>
      sampleTrack({ objectId: 'x', keys: r.keys }, t)!.pose!.rightArm[0]
    expect(at(touching, 2.6)).toBeLessThan(-60)
    expect(at(touching, 3.7)).toBeGreaterThan(-5)
    expect(at(apart, 2.55)).toBeGreaterThan(-60)
  })
})

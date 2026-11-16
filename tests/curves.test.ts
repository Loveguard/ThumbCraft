import { describe, expect, it } from 'vitest'
import { channelsOf, channelValue, withChannel } from '@shared/curves'
import { fullPose } from '@shared/minecraft/playerModel'

const key = { t: 0, position: [1, 2, 3] as [number, number, number], rotation: [0, 90, 0] as [number, number, number] }

describe('curves', () => {
  it('lists position and turn for any track, joints for a pose, parts for a mob', () => {
    expect(channelsOf({ keys: [key] }).map((c) => c.id)).toEqual(['pos.0', 'pos.1', 'pos.2', 'rot.0', 'rot.1', 'rot.2'])
    const withPose = channelsOf({ keys: [{ ...key, pose: fullPose(undefined) }] })
    expect(withPose.some((c) => c.id === 'pose.rightArm.0')).toBe(true)
    const mob = channelsOf({ keys: [{ ...key, parts: { 'body/right_arm': [1, 2, 3] } }] })
    expect(mob.at(-1)!.id).toBe('part.body/right_arm.2')
  })

  it('reads and sets a channel without touching the others', () => {
    expect(channelValue(key, 'pos.1')).toBe(2)
    expect(withChannel(key, 'pos.1', 5).position).toEqual([1, 5, 3])
    const posed = { ...key, pose: fullPose({ rightArm: [-90, 0, 0] }) }
    expect(channelValue(posed, 'pose.rightArm.0')).toBe(-90)
    const next = withChannel(posed, 'pose.rightArm.2', 20)
    expect(next.pose!.rightArm).toEqual([-90, 0, 20])
    expect(next.pose!.head).toEqual(posed.pose.head)
    const mob = withChannel({ ...key, parts: { 'a/b': [1, 1, 1] } }, 'part.a/b.0', 30)
    expect(mob.parts!['a/b']).toEqual([30, 1, 1])
    expect(withChannel(key, 'pos.9', 1)).toBe(key)
  })
})

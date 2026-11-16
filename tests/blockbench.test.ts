import { describe, expect, it } from 'vitest'
import { fromBlockbench, toBlockbench, type Sample } from '@shared/blockbench'
import { fullPose } from '@shared/minecraft/playerModel'

const samples: Sample[] = [0, 0.5, 1].map((t, i) => ({
  t,
  pose: fullPose({ head: [10 * i, 20 * i, 5 * i], rightArm: [-90 * i, 0, -10 * i], leftShin: [30 * i, 0, 0] }),
  root: [0.5 * i, 0, 2 * i]
}))

describe('Blockbench animations', () => {
  it('survives a round trip', () => {
    const file = JSON.stringify(toBlockbench('Greeting', samples, { loop: true }))
    const [a] = fromBlockbench(file)
    expect(a.name).toBe('Greeting')
    expect(a.loop).toBe(true)
    expect(a.length).toBe(1)
    expect(a.samples.map((s) => s.t)).toEqual([0, 0.5, 1])
    expect(a.samples[2].pose.head).toEqual([20, 40, 10])
    expect(a.samples[1].pose.rightArm).toEqual([-90, 0, -10])
    expect(a.samples[2].root).toEqual([1, 0, 4])
  })

  it('writes the vanilla bone names', () => {
    const file = toBlockbench('x', samples, { loop: false }) as { animations: Record<string, { bones: object }> }
    const bones = Object.keys(Object.values(file.animations)[0].bones)
    expect(bones).toEqual(
      expect.arrayContaining(['head', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg', 'root'])
    )
  })

  it('reads files from Blockbench itself: shared bone names, pre and post values, numbers as text', () => {
    const file = JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.wave': {
          animation_length: 2,
          bones: {
            rightarm: { rotation: { '0': [0, 0, 0], '1.0': { post: [-120, 0, 0] }, '2': ['0', '0', '0'] } },
            Head: { rotation: [0, 30, 0] },
            tail: { rotation: [1, 2, 3] },
            body: { rotation: { '0': ['math.sin(query.anim_time)', 0, 0] } }
          }
        }
      }
    })
    const [a] = fromBlockbench(file)
    expect(a.name).toBe('wave')
    expect(a.samples.find((s) => s.t === 1)!.pose.rightArm).toEqual([-120, 0, 0])
    // A single value stays for the whole animation (and the sign of yaw is ours).
    expect(a.samples[0].pose.head).toEqual([0, -30, 0])
    expect(a.skipped.join()).toMatch(/tail/)
    expect(a.skipped.join()).toMatch(/body rotation/)
  })

  it('says what is wrong with a file that is not one', () => {
    expect(() => fromBlockbench('nope')).toThrow(/Blockbench/)
    expect(() => fromBlockbench('{"animations":{"a":{"bones":{"tail":{"rotation":[0,0,0]}}}}}')).toThrow(
      /match a player/
    )
  })
})

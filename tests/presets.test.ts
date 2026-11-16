import { describe, expect, it } from 'vitest'
import { compileClips, sampleTrack, type Clip } from '@shared/animation'
import { POSES } from '@shared/minecraft/playerModel'
import {
  cleanPreset,
  clipsFrom,
  fromFrame,
  STARTER_PRESETS,
  packFromBytes,
  packToBytes,
  presetFrom,
  toFrame,
  type Origin
} from '@shared/presets'

const here: Origin = { position: [3, 1, -2], yaw: 0.6 }

describe('frames', () => {
  it("turns a world point into the character's own and back again", () => {
    const p: [number, number, number] = [7, 2, 5]
    const q = fromFrame(toFrame(p, here), here)
    expect(q[0]).toBeCloseTo(7, 2)
    expect(q[1]).toBeCloseTo(2, 2)
    expect(q[2]).toBeCloseTo(5, 2)
  })
  it('puts "ahead" along the way it faces', () => {
    const ahead = fromFrame([0, 0, 2], { position: [0, 0, 0], yaw: Math.PI / 2 })
    expect(ahead[0]).toBeCloseTo(2, 2)
    expect(ahead[2]).toBeCloseTo(0, 2)
  })
})

describe('presets', () => {
  const clips: Clip[] = [
    { id: 'a', type: 'walk', start: 2, duration: 3, path: [[8, 1, 3]] },
    { id: 'b', type: 'wave', start: 3, duration: 1.5, layer: 'upper' },
    { id: 'c', type: 'point', start: 5, duration: 1 }
  ]

  it('replays from anywhere: the same walk, turned and moved to where the next character is', () => {
    const a: Origin = { position: [0, 0, 0], yaw: 0 }
    const preset = presetFrom('Greet', clips, a)
    expect(preset.duration).toBe(4)
    expect(preset.clips.map((c) => c.offset)).toEqual([0, 1, 3])
    const there: Origin = { position: [10, 0, 10], yaw: Math.PI }
    const out = clipsFrom(preset, 6, there)
    expect(out[0].start).toBe(6)
    expect(out[1].layer).toBe('upper')
    const who = {
      kind: 'player' as const,
      scale: 1,
      rotation: [0, 180, 0] as [number, number, number],
      pose: POSES.Standing,
      position: [10, 0, 10] as [number, number, number]
    }
    const { keys } = compileClips(out, who)
    const end = sampleTrack({ objectId: 'x', keys }, 9)!
    // The walk was 5 blocks over and 5 ahead in the first frame; here it goes the other way round.
    expect(Math.hypot(end.position[0] - 10, end.position[2] - 10)).toBeGreaterThan(4)
  })

  it('travels as a file and refuses what is not one', () => {
    const preset = presetFrom('Greet', clips, { position: [0, 0, 0], yaw: 0 })
    const back = packFromBytes(packToBytes('Mine', [preset]))
    expect(back.name).toBe('Mine')
    expect(back.presets[0].clips).toHaveLength(3)
    expect(() => packFromBytes(new TextEncoder().encode('not json'))).toThrow()
    expect(() => packFromBytes(new TextEncoder().encode('{"format":"other"}'))).toThrow()
  })

  it('drops blocks it does not know and numbers that make no sense', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        format: 'thumbcraft-presets',
        version: 1,
        name: 'x',
        presets: [
          {
            id: 'p',
            name: 'Bad',
            clips: [
              { type: 'explode', offset: 0, duration: 1 },
              { type: 'walk', offset: 0, duration: -3 },
              { type: 'walk', offset: 0, duration: 2, path: [[0, 0, NaN]] },
              { type: 'wave', offset: 1, duration: 2, layer: 'upper' },
              { type: 'walk', offset: 0, duration: 2, layer: 'upper' }
            ]
          }
        ]
      }).replace('NaN', 'null')
    )
    const { presets } = packFromBytes(bytes)
    expect(presets[0].clips.map((c) => c.type)).toEqual(['walk', 'wave', 'walk'])
    expect(presets[0].clips[0].path).toBeUndefined()
    // A walk can't go on the upper row.
    expect(presets[0].clips[2].layer).toBeUndefined()
  })
})

describe('starter presets', () => {
  it('are made of real blocks that fit one after the other, and compile', () => {
    expect(STARTER_PRESETS.length).toBeGreaterThanOrEqual(8)
    const ids = new Set(STARTER_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(STARTER_PRESETS.length)
    for (const p of STARTER_PRESETS) {
      expect(cleanPreset(p)).not.toBeNull()
      const clips = clipsFrom(p, 0, { position: [0, 0, 0], yaw: 0 })
      const { keys } = compileClips(clips, {
        kind: 'player',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1
      })
      expect(keys.at(-1)!.t).toBeCloseTo(p.duration, 1)
    }
  })
})

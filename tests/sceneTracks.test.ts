import { describe, expect, it } from 'vitest'
import {
  cleanSceneTracks,
  countText,
  putSceneKey,
  typedText,
  sampleScene,
  sceneLength,
  type SceneTrack
} from '@shared/sceneTracks'
import { animationLength } from '@shared/animation'

const track = (prop: SceneTrack['prop'], keys: [number, number][]): SceneTrack => ({
  id: 'a',
  prop,
  keys: keys.map(([t, v]) => ({ t, v }))
})

describe('scene tracks', () => {
  it('eases between keys and holds at the ends', () => {
    const t = track('sunAzimuth', [
      [1, 0],
      [3, 100]
    ])
    expect(sampleScene(t, 0)).toBe(0)
    expect(sampleScene(t, 2)).toBeCloseTo(50, 5)
    expect(sampleScene(t, 9)).toBe(100)
    expect(sampleScene(track('sunAzimuth', []), 1)).toBeNull()
  })

  it('jumps for visibility', () => {
    const t = track('visible', [
      [0, 1],
      [2, 0]
    ])
    expect(sampleScene(t, 1.99)).toBe(1)
    expect(sampleScene(t, 2)).toBe(0)
  })

  it('replaces a key at the same time and keeps order', () => {
    const keys = putSceneKey(putSceneKey([{ t: 2, v: 1 }], { t: 0, v: 5 }), { t: 2, v: 7 })
    expect(keys).toEqual([
      { t: 0, v: 5 },
      { t: 2, v: 7 }
    ])
  })

  it('cleans what a save might hold, and counts towards the length', () => {
    const raw = [
      {
        id: 'x',
        prop: 'exposure',
        keys: [
          { t: 4, v: 9 },
          { t: 1, v: 0 },
          { t: 'bad', v: 1 }
        ]
      },
      { id: 'y', prop: 'nonsense', keys: [] },
      null
    ]
    const out = cleanSceneTracks(raw)
    expect(out).toHaveLength(1)
    expect(out[0].keys).toEqual([
      { t: 1, v: 0 },
      { t: 4, v: 2 }
    ])
    expect(sceneLength(out)).toBe(4)
    expect(animationLength({ fps: 30, loop: true, tracks: [], scene: out })).toBe(4)
  })

  it('types text out and counts', () => {
    expect(typedText('HELLO', 0)).toBe('')
    expect(typedText('HELLO', 0.4)).toBe('HE')
    expect(typedText('HELLO', 2)).toBe('HELLO')
    expect(countText(41.6)).toBe('42')
  })
})

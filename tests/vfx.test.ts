import { describe, expect, it } from 'vitest'
import { VFX_PRESETS, vfxLayers } from '../src/renderer/src/vfx'

describe('special effects', () => {
  it('every effect draws something, the same way for the same seed', () => {
    for (const p of VFX_PRESETS) {
      const a = vfxLayers(p.id, p.density, 42)
      expect(a.length, p.id).toBeGreaterThan(0)
      expect(
        a.reduce((n, l) => n + l.puffs.length, 0),
        p.id
      ).toBeGreaterThan(5)
      expect(vfxLayers(p.id, p.density, 42)).toEqual(a)
      for (const l of a)
        for (const puff of l.puffs)
          expect(Number.isFinite(puff.x + puff.y + puff.z + puff.size + puff.alpha)).toBe(true)
    }
  })

  it('thickness adds puffs', () => {
    const count = (d: number): number => vfxLayers('smoke', d, 1)[0].puffs.length
    expect(count(1)).toBeGreaterThan(count(0))
  })
})

import { describe, expect, it } from 'vitest'
import { JavaRandom } from '@shared/minecraft/javaRandom'
import { lightningGeometry } from '@shared/minecraft/lightning'

describe('JavaRandom', () => {
  it('matches java.util.Random', () => {
    // Well-known values: new Random(42).nextInt() and new Random(0).nextInt(10) / nextInt(100).
    expect(new JavaRandom(42).nextInt()).toBe(-1170105035)
    expect(new JavaRandom(42).nextInt(10)).toBe(0)
    expect(new JavaRandom(0).nextInt(100)).toBe(60)
  })
})

describe('lightning bolt', () => {
  it('strikes the origin and is deterministic per seed', () => {
    const g = lightningGeometry(12345)
    // 4 layers × (8 + 3 + 3 segments) × 4 quads × 6 vertices × 3 floats
    expect(g.length).toBe(4 * 14 * 4 * 6 * 3)
    expect(lightningGeometry(12345)).toEqual(g)
    expect(lightningGeometry(999)).not.toEqual(g)
    // The trunk's lowest quads sit at y=0 around x=z=0.
    let nearest = Infinity
    for (let i = 0; i < g.length; i += 3) if (g[i + 1] === 0) nearest = Math.min(nearest, Math.hypot(g[i], g[i + 2]))
    expect(nearest).toBeLessThan(1)
  })

  it('slims the bolt without moving its path', () => {
    const full = lightningGeometry(777)
    const slim = lightningGeometry(777, 0.5)
    expect(slim.length).toBe(full.length)
    // Heights are identical; the sideways spread around each segment's centre is halved.
    for (let i = 1; i < full.length; i += 3) expect(slim[i]).toBe(full[i])
    const spread = (g: Float32Array): number => {
      let s = 0
      for (let q = 0; q < g.length; q += 18) s += Math.hypot(g[q] - g[q + 15], g[q + 2] - g[q + 17])
      return s
    }
    expect(spread(slim)).toBeLessThan(spread(full) * 0.8)
  })
})

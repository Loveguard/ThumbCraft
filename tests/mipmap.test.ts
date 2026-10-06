import { describe, expect, it } from 'vitest'
import { vanillaMipmaps } from '../src/shared/minecraft/mipmap'

/** 2×2 RGBA image from four [r, g, b, a] pixels. */
const img = (...px: number[][]): { width: number; height: number; data: Uint8ClampedArray } => ({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray(px.flat())
})

describe('vanilla mipmaps', () => {
  const leaf = [60, 120, 40, 255]
  const hole = [0, 0, 0, 0]

  it('drops texels whose blended alpha falls below 96, as the game does', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    data.set(leaf, 0) // one leaf texel in a 4×4 tile
    const [l1, l2] = vanillaMipmaps({ width: 4, height: 4, data }, 2, () => true)
    expect(l1.data[3]).toBe(Math.trunc(Math.pow(0.25, 1 / 2.2) * 255)) // 135: still drawn
    expect(l2.data[3]).toBe(0)
    expect(vanillaMipmaps(img(hole, hole, hole, hole), 1, () => true)[0].data[3]).toBe(0)
  })

  it('weights alpha with gamma like the game (two of four stay opaque enough to draw)', () => {
    const [m] = vanillaMipmaps(img(leaf, leaf, hole, hole), 1, () => true)
    expect(m.data[3]).toBe(Math.trunc(Math.pow(0.5, 1 / 2.2) * 255))
  })

  it('averages opaque textures in gamma space', () => {
    const [m] = vanillaMipmaps(
      img([0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255]),
      1,
      () => false
    )
    expect(m.data[0]).toBe(Math.trunc(Math.pow(0.5, 1 / 2.2) * 255))
    expect(m.data[3]).toBe(255)
  })

  it('stops at the requested level count', () => {
    const base = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4).fill(255) }
    expect(vanillaMipmaps(base, 4, () => false).map((m) => m.width)).toEqual([16, 8, 4, 2])
  })
})

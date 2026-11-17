import { describe, expect, it } from 'vitest'
import { splitEffect } from '../src/renderer/src/psdLayers'

const px = (...v: number[]): Uint8ClampedArray => new Uint8ClampedArray(v)

/** Photoshop's stack: a Normal layer over the frame, then a Linear Dodge (Add) layer. */
function stack(before: Uint8ClampedArray, cover: Uint8ClampedArray, light: Uint8ClampedArray): number[] {
  const out = Array.from(before)
  for (let i = 0; i < out.length; i += 4)
    for (let k = 0; k < 3; k++) {
      if (cover[i + 3]) out[i + k] = cover[i + k]
      if (light[i + 3]) out[i + k] = Math.min(255, out[i + k] + light[i + k])
    }
  return out
}

describe('splitEffect', () => {
  // Pixel 1 untouched, 2 lit by the glow, 3 covered by dark smoke, 4 tinted (one channel down).
  const before = px(10, 20, 30, 255, 100, 80, 60, 255, 200, 200, 200, 255, 50, 150, 50, 255)
  const after = px(10, 20, 30, 255, 180, 120, 60, 255, 40, 40, 40, 255, 90, 140, 50, 255)
  const { cover, light } = splitEffect(after, before)

  it('gives the frame with the effect back when stacked', () => {
    expect(stack(before, cover, light)).toEqual(Array.from(after))
  })

  it('puts brightening in the light layer and the rest in the cover layer', () => {
    expect(Array.from(light.slice(4, 8))).toEqual([80, 40, 0, 255])
    expect(light[3]).toBe(0)
    expect(cover[11]).toBe(255)
    expect(cover[15]).toBe(255)
    expect(cover[7]).toBe(0)
  })
})

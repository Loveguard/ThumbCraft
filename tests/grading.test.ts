import { describe, expect, it } from 'vitest'
import { gradeColor, LOOKS, parseCube } from '../src/renderer/src/grading'

const luma = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('colour looks', () => {
  it('an empty grade leaves colours alone (below the highlight roll-off)', () => {
    for (const c of [
      [0, 0, 0],
      [0.2, 0.5, 0.3],
      [0.8, 0.4, 0.1]
    ] as [number, number, number][])
      gradeColor(c, {}).forEach((v, i) => expect(v).toBeCloseTo(c[i], 3))
  })

  it('no look crushes the shade or washes out the midtones', () => {
    for (const look of LOOKS) {
      // Shade (a dark grass green) must stay visible; a mid grey must stay a midtone.
      const shade = luma(gradeColor([0.12, 0.2, 0.08], look.grade))
      const mid = luma(gradeColor([0.45, 0.45, 0.45], look.grade))
      expect(shade, look.id).toBeGreaterThan(0.06)
      expect(mid, look.id).toBeGreaterThan(0.25)
      expect(mid, look.id).toBeLessThan(0.7)
    }
  })

  it('keeps black near black and white bright', () => {
    for (const look of LOOKS) {
      expect(luma(gradeColor([0, 0, 0], look.grade)), look.id).toBeLessThan(0.08)
      expect(luma(gradeColor([1, 1, 1], look.grade)), look.id).toBeGreaterThan(0.75)
    }
  })

  it('reads .cube LUTs', () => {
    const rows: string[] = ['TITLE "test"', 'LUT_3D_SIZE 2']
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r} ${g} ${b}`)
    const lut = parseCube(rows.join('\n'))
    expect(lut.image.width).toBe(2)
    expect(() => parseCube('not a lut')).toThrow()
  })
})

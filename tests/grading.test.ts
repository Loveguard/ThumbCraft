import { describe, expect, it } from 'vitest'
import { currentLookId, gradeColor, LOOKS, lookSettings, parseCube, RETIRED_LOOKS } from '../src/renderer/src/grading'

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

  it('has six looks that each look clearly different', () => {
    expect(LOOKS).toHaveLength(6)
    // A spread of scene colours: grass, sky, skin, stone, lava, shade, a bright cloud.
    const palette: [number, number, number][] = [
      [0.42, 0.68, 0.28],
      [0.45, 0.65, 0.95],
      [0.85, 0.62, 0.48],
      [0.5, 0.5, 0.5],
      [0.95, 0.45, 0.1],
      [0.15, 0.2, 0.12],
      [0.92, 0.94, 0.96]
    ]
    for (const a of LOOKS)
      for (const b of LOOKS) {
        if (a.id >= b.id) continue
        const diff =
          palette.reduce((sum, c) => {
            const x = gradeColor(c, a.grade)
            const y = gradeColor(c, b.grade)
            return sum + Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
          }, 0) / palette.length
        expect(diff, `${a.id} vs ${b.id}`).toBeGreaterThan(0.08)
      }
  })

  it('opens retired looks as the look that replaced them', () => {
    for (const [old, now] of Object.entries(RETIRED_LOOKS)) {
      expect(currentLookId(old)).toBe(now)
      expect(lookSettings(old).look).toBe(now)
    }
    expect(currentLookId('fuji')).toBe('fuji')
  })

  it('reads .cube LUTs', () => {
    const rows: string[] = ['TITLE "test"', 'LUT_3D_SIZE 2']
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r} ${g} ${b}`)
    const lut = parseCube(rows.join('\n'))
    expect(lut.image.width).toBe(2)
    expect(() => parseCube('not a lut')).toThrow()
  })
})

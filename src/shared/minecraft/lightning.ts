// The lightning bolt's shape, ported from vanilla's LightningBoltRenderer: eight 16-block segments that
// zig-zag down to the strike point, two side branches, drawn as four nested layers of glowing quads.
// Same seed, same bolt as the game.
import { JavaRandom } from './javaRandom'

/** Vanilla's per-layer bolt opacity (drawn with additive blending). */
export const LIGHTNING_ALPHA = 0.3

/** Triangle positions (x, y, z per vertex) of a bolt that strikes the origin, in blocks. */
export function lightningGeometry(seed: number | bigint): Float32Array {
  const xs = new Array<number>(8)
  const zs = new Array<number>(8)
  let x = 0
  let z = 0
  const random = new JavaRandom(seed)
  for (let i = 7; i >= 0; i--) {
    xs[i] = x
    zs[i] = z
    x += random.nextInt(11) - 5
    z += random.nextInt(11) - 5
  }
  const out: number[] = []
  // One quad: from (x1, z1) at the segment's bottom to (x2, z2) at its top, offset to one side.
  const quad = (
    x1: number,
    z1: number,
    seg: number,
    x2: number,
    z2: number,
    w1: number,
    w2: number,
    a: boolean,
    b: boolean,
    c: boolean,
    d: boolean
  ): void => {
    const v = [
      [x1 + (a ? w2 : -w2), seg * 16, z1 + (b ? w2 : -w2)],
      [x2 + (a ? w1 : -w1), (seg + 1) * 16, z2 + (b ? w1 : -w1)],
      [x2 + (c ? w1 : -w1), (seg + 1) * 16, z2 + (d ? w1 : -w1)],
      [x1 + (c ? w2 : -w2), seg * 16, z1 + (d ? w2 : -w2)]
    ]
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...v[i])
  }
  for (let layer = 0; layer < 4; layer++) {
    const r = new JavaRandom(seed)
    for (let branch = 0; branch < 3; branch++) {
      const top = branch > 0 ? 7 - branch : 7
      const bottom = branch > 0 ? top - 2 : 0
      let h = xs[top] - x
      let n = zs[top] - z
      for (let seg = top; seg >= bottom; seg--) {
        const p = h
        const q = n
        if (branch === 0) {
          h += r.nextInt(11) - 5
          n += r.nextInt(11) - 5
        } else {
          h += r.nextInt(31) - 15
          n += r.nextInt(31) - 15
        }
        let w1 = 0.1 + layer * 0.2
        if (branch === 0) w1 *= seg * 0.1 + 1
        let w2 = 0.1 + layer * 0.2
        if (branch === 0) w2 *= (seg - 1) * 0.1 + 1
        quad(h, n, seg, p, q, w1, w2, false, false, true, false)
        quad(h, n, seg, p, q, w1, w2, true, false, true, true)
        quad(h, n, seg, p, q, w1, w2, true, true, false, true)
        quad(h, n, seg, p, q, w1, w2, false, true, false, false)
      }
    }
  }
  return new Float32Array(out)
}

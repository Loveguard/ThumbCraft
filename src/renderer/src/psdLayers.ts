// Pixel maths for the layered Photoshop export, kept free of the DOM and the 3D scene so it can be tested.

/** RGBA pixels, four bytes each. */
type Pixels = Uint8ClampedArray<ArrayBuffer>

/**
 * What an effect adds to a frame, as two layers: `cover` holds the pixels it darkens or covers (smoke, debris),
 * as they look with it, for a Normal layer; `light` holds how much brighter it makes the rest (flames, glow, the
 * light it throws on things around it), for a Linear Dodge (Add) layer. Stacked on `before`, the two give `after`
 * exactly; hidden, they leave `before`. Pixels the effect doesn't touch stay see-through in both.
 */
export function splitEffect(after: Uint8ClampedArray, before: Uint8ClampedArray): { cover: Pixels; light: Pixels } {
  const cover = new Uint8ClampedArray(after.length)
  const light = new Uint8ClampedArray(after.length)
  for (let i = 0; i < after.length; i += 4) {
    const dr = after[i] - before[i]
    const dg = after[i + 1] - before[i + 1]
    const db = after[i + 2] - before[i + 2]
    if (!dr && !dg && !db) continue
    if (dr >= 0 && dg >= 0 && db >= 0) {
      light[i] = dr
      light[i + 1] = dg
      light[i + 2] = db
      light[i + 3] = 255
    } else {
      cover[i] = after[i]
      cover[i + 1] = after[i + 1]
      cover[i + 2] = after[i + 2]
      cover[i + 3] = 255
    }
  }
  return { cover, light }
}

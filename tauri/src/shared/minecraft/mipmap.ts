// Mipmaps built the way Minecraft builds them (MipmapGenerator), so cutout blocks such as Fancy leaves
// keep their holes at a distance. GPU-generated mips box-filter alpha in linear space, which fills
// leaves in until they pass the alpha test everywhere and look like Fast graphics.

/** Minecraft's default "Mipmap Levels" setting. */
export const VANILLA_MIP_LEVELS = 4

const POW22 = new Float32Array(256)
for (let i = 0; i < 256; i++) POW22[i] = Math.pow(i / 255, 2.2)
const unPow22 = (v: number): number => Math.trunc(Math.pow(v, 1 / 2.2) * 255)

export interface MipLevel {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Builds mip levels 1..levels of an RGBA image. `transparent(x, y)` says whether the base-level pixel
 * belongs to a texture with fully transparent pixels; those use the game's alpha-weighted blend
 * (transparent texels add nothing, alpha below 96 is dropped), the rest a plain gamma-correct average.
 */
export function vanillaMipmaps(
  base: MipLevel,
  levels: number,
  transparent: (x: number, y: number) => boolean
): MipLevel[] {
  const out: MipLevel[] = []
  let prev = base
  for (let k = 1; k <= levels; k++) {
    const width = prev.width >> 1
    const height = prev.height >> 1
    if (width < 1 || height < 1) break
    const data = new Uint8ClampedArray(width * height * 4)
    const p = prev.data
    const pw = prev.width
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = (y * 2 * pw + x * 2) * 4
        const src = [a, a + 4, a + pw * 4, a + pw * 4 + 4]
        const o = (y * width + x) * 4
        if (transparent(x << k, y << k)) {
          let r = 0
          let g = 0
          let b = 0
          let al = 0
          for (const s of src) {
            if (p[s + 3] === 0) continue
            r += POW22[p[s]]
            g += POW22[p[s + 1]]
            b += POW22[p[s + 2]]
            al += POW22[p[s + 3]]
          }
          const alpha = unPow22(al / 4)
          data[o] = unPow22(r / 4)
          data[o + 1] = unPow22(g / 4)
          data[o + 2] = unPow22(b / 4)
          data[o + 3] = alpha < 96 ? 0 : alpha
        } else {
          for (let c = 0; c < 4; c++) {
            data[o + c] = unPow22(
              (POW22[p[src[0] + c]] + POW22[p[src[1] + c]] + POW22[p[src[2] + c]] + POW22[p[src[3] + c]]) / 4
            )
          }
        }
      }
    }
    prev = { width, height, data }
    out.push(prev)
  }
  return out
}

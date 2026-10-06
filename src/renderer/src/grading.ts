// Colour looks as 3D LUTs, the way grading works in DaVinci Resolve or Premiere: each look is a colour
// transform baked into a 33×33×33 lookup table and applied in one GPU lookup, with an intensity slider that
// blends between the original and the graded image. Users can also bring their own .cube LUTs.
//
// The built-in looks are written as film-style grades rather than blunt sliders, so none of them crush the
// blacks or bleach the image:
// - white balance happens in linear light, scaled so overall brightness stays put;
// - lift / gamma / gain (ASC CDL style) shape shadows, midtones and highlights separately, per channel;
// - contrast is an S-curve that bends around a mid-grey pivot but always keeps 0 → 0 and 1 → 1;
// - vibrance boosts dull colours more than strong ones (and spares skin tones);
// - split toning tints shadows and highlights, then restores each pixel's brightness.
import { LookupTexture } from 'postprocessing'
import * as THREE from 'three'
import type { EffectSettings } from './store'
import { LUTCubeLoader } from 'three/examples/jsm/loaders/LUTCubeLoader.js'

type RGB = [number, number, number]

export interface Grade {
  /** -1 cool … +1 warm, and -1 green … +1 magenta (linear-light white balance). */
  temperature?: number
  tint?: number
  /** Stops of exposure. */
  exposure?: number
  /** CDL-style per-channel shaping: lift adds in the shadows, gamma bends the midtones, gain scales highlights. */
  lift?: RGB
  gamma?: RGB
  gain?: RGB
  /** S-curve strength (0 = none, 1 = strong) around `pivot` (mid-grey by default). */
  contrast?: number
  pivot?: number
  /** Plain saturation multiplier offset (-1 … +1) and vibrance (smart saturation). */
  saturation?: number
  vibrance?: number
  /** Tints for shadows and highlights (sRGB colours) and how strong each is. */
  shadows?: { color: string; amount: number }
  highlights?: { color: string; amount: number }
  /** Raises the black point (a matte film fade, 0 … 0.2) and lowers the white point. */
  fade?: number
  ceiling?: number
}

const srgbToLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const hex = (color: string): RGB => {
  const c = new THREE.Color(color)
  return [c.r, c.g, c.b].map(linearToSrgb) as RGB
}

/**
 * A filmic S-curve through (0,0), (pivot,pivot) and (1,1). Most of the contrast goes into the highlights:
 * shade only gets a gentle push, so it keeps its detail instead of sinking into black.
 */
function sCurve(x: number, amount: number, pivot: number): number {
  if (amount === 0) return x
  const a = Math.abs(amount)
  const lo = 1 + a * 0.45
  const hi = 1 + a * 1.1
  const y = x < pivot ? pivot * (x / pivot) ** lo : 1 - (1 - pivot) * ((1 - x) / (1 - pivot)) ** hi
  return amount > 0 ? y : x + (x - y) * Math.min(1, a) // negative contrast flattens
}

/** The look applied to one display (sRGB, 0…1) colour. */
export function gradeColor(input: RGB, g: Grade): RGB {
  // White balance and exposure in linear light.
  let lin = input.map(srgbToLinear) as RGB
  const t = g.temperature ?? 0
  const ti = g.tint ?? 0
  const wb: RGB = [1 + 0.2 * t + 0.05 * ti, 1 - 0.1 * ti, 1 - 0.25 * t + 0.05 * ti]
  const norm = luma(wb)
  const ev = 2 ** (g.exposure ?? 0)
  lin = lin.map((v, i) => (v * wb[i] * ev) / norm) as RGB
  let c = lin.map((v) => linearToSrgb(Math.max(0, v))) as RGB

  // Lift / gamma / gain, per channel.
  const lift = g.lift ?? [0, 0, 0]
  const gamma = g.gamma ?? [1, 1, 1]
  const gain = g.gain ?? [1, 1, 1]
  c = c.map((v, i) => {
    const x = clamp01(v * gain[i] + lift[i] * (1 - v))
    return x ** (1 / gamma[i])
  }) as RGB

  // Contrast as an S-curve on brightness, applied as a ratio so hues don't shift.
  const pivot = g.pivot ?? 0.4
  if (g.contrast) {
    const l = luma(c)
    const target = sCurve(clamp01(l), g.contrast, pivot)
    c = (l > 1e-4 ? c.map((v) => v * (target / l)) : [target, target, target]) as RGB
  }

  // Saturation and vibrance around each pixel's own brightness.
  {
    const l = luma(c)
    const hi = Math.max(...c)
    const sat = hi > 1e-4 ? (hi - Math.min(...c)) / hi : 0
    // Skin (orange, moderately saturated) gets only half the vibrance boost.
    const skin = c[0] > c[1] && c[1] > c[2] && sat > 0.2 && sat < 0.6 ? 0.5 : 1
    const s = 1 + (g.saturation ?? 0) + (g.vibrance ?? 0) * (1 - sat) * (1 - sat) * skin
    c = c.map((v) => l + (v - l) * s) as RGB
  }

  // Split toning, then put the brightness back so tints never darken or wash out the image.
  if (g.shadows || g.highlights) {
    const l = luma(c)
    const shade = (1 - Math.min(1, l / 0.6)) ** 2
    const light = Math.max(0, (l - 0.4) / 0.6) ** 2
    const add = (tone: { color: string; amount: number } | undefined, w: number): void => {
      if (!tone) return
      const tc = hex(tone.color)
      const tl = luma(tc)
      c = c.map((v, i) => v + (tc[i] - tl) * tone.amount * w) as RGB
    }
    add(g.shadows, shade)
    add(g.highlights, light)
    const now = luma(c)
    if (now > 1e-4) c = c.map((v) => v * (l / now)) as RGB
  }

  // Black and white points (a matte fade keeps shadows soft without greying the midtones).
  const fade = g.fade ?? 0
  const ceiling = g.ceiling ?? 1
  // A soft shoulder near white, so highlights roll off like film instead of clipping.
  c = c.map((v) => {
    const x = Math.max(0, v)
    const rolled = x < 0.85 ? x : 0.85 + 0.15 * (1 - Math.exp(-(x - 0.85) / 0.15))
    return fade + rolled * (ceiling - fade)
  }) as RGB
  return c.map(clamp01) as RGB
}

const LUT_SIZE = 33

/** Bakes a look into a 3D LUT texture (input and output in sRGB, as .cube files are). */
export function bakeLut(g: Grade, size = LUT_SIZE): LookupTexture {
  // 8-bit entries: every GPU can filter these smoothly (float LUTs need an extension some drivers lack,
  // and without it they sample as black).
  const data = new Uint8Array(size * size * size * 4)
  let i = 0
  for (let b = 0; b < size; b++)
    for (let gr = 0; gr < size; gr++)
      for (let r = 0; r < size; r++) {
        const out = gradeColor([r / (size - 1), gr / (size - 1), b / (size - 1)], g)
        data.set([Math.round(out[0] * 255), Math.round(out[1] * 255), Math.round(out[2] * 255), 255], i)
        i += 4
      }
  const lut = new LookupTexture(data, size)
  lut.type = THREE.UnsignedByteType
  lut.needsUpdate = true
  return lut
}

/** Reads a .cube LUT (DaVinci Resolve, Premiere, most LUT packs). */
export function parseCube(text: string): THREE.Data3DTexture {
  const result = new LUTCubeLoader().parse(text) as unknown as { texture3D: THREE.Data3DTexture }
  if (!result?.texture3D) throw new Error('Not a 3D .cube LUT')
  return result.texture3D
}

export interface Look {
  id: string
  label: string
  hint: string
  grade: Grade
  /** Lens and light effects the look turns on with it (left off when the user already has them on). */
  extras?: Partial<EffectSettings> & { sunInView?: boolean }
}

/**
 * Built-in looks, tuned for thumbnails: they change mood and colour, never readability. Each one keeps real
 * blacks and clean whites; the intensity slider takes any of them from a hint to the full grade.
 */
export const LOOKS = [
  {
    id: 'pop',
    label: 'Thumbnail pop',
    hint: 'Clean, bright and vivid: colours jump without anything clipping',
    grade: {
      vibrance: 0.7,
      saturation: 0.05,
      contrast: 0.35,
      exposure: 0.12,
      temperature: 0.06,
      lift: [0.01, 0.01, 0.02]
    }
  },
  {
    id: 'teal-orange',
    label: 'Teal & orange',
    hint: 'The blockbuster look: cool teal shade, warm skin and highlights',
    grade: {
      contrast: 0.35,
      vibrance: 0.25,
      shadows: { color: '#1f8a99', amount: 0.32 },
      highlights: { color: '#ffa24d', amount: 0.35 },
      lift: [0, 0.01, 0.02]
    },
    extras: { vignette: true, vignetteDarkness: 0.35 }
  },
  {
    id: 'golden',
    label: 'Golden hour',
    hint: 'Low warm sun, honey highlights, soft violet shade',
    grade: {
      temperature: 0.45,
      exposure: 0.05,
      contrast: 0.25,
      vibrance: 0.3,
      highlights: { color: '#ffb347', amount: 0.45 },
      shadows: { color: '#6a4c93', amount: 0.25 },
      gain: [1.04, 1, 0.94]
    },
    extras: {
      bloom: true,
      bloomIntensity: 0.6,
      bloomThreshold: 0.75,
      godRays: true,
      godRaysIntensity: 0.6,
      sunColor: '#ffc06b',
      sunInView: true
    }
  },
  {
    id: 'cinema-cool',
    label: 'Cinematic cool',
    hint: 'Modern film: cool steel shade, neutral midtones, filmic contrast',
    grade: {
      temperature: -0.15,
      contrast: 0.35,
      saturation: -0.05,
      vibrance: 0.15,
      shadows: { color: '#2e5a87', amount: 0.25 },
      highlights: { color: '#ffe2c4', amount: 0.15 },
      fade: 0.015
    },
    extras: { vignette: true, vignetteDarkness: 0.4, grain: true, grainAmount: 0.05 }
  },
  {
    id: 'bright-airy',
    label: 'Bright & airy',
    hint: 'Light and fresh: lifted shade and soft pastels that keep their colour',
    grade: {
      exposure: 0.2,
      contrast: -0.25,
      vibrance: 0.35,
      lift: [0.04, 0.045, 0.06],
      temperature: 0.05,
      highlights: { color: '#fff1e0', amount: 0.2 }
    }
  },
  {
    id: 'film',
    label: 'Vintage film',
    hint: 'Warm film stock: matte blacks, creamy highlights, gentle green shade',
    grade: {
      temperature: 0.2,
      contrast: 0.3,
      saturation: -0.12,
      fade: 0.06,
      ceiling: 0.96,
      shadows: { color: '#3f6b55', amount: 0.18 },
      highlights: { color: '#ffd9a0', amount: 0.3 }
    },
    extras: { grain: true, grainAmount: 0.12, vignette: true, vignetteDarkness: 0.45 }
  },
  {
    id: 'night',
    label: 'Moonlight',
    hint: 'Blue night that stays readable: deep but never muddy',
    grade: {
      temperature: -0.55,
      exposure: -0.45,
      contrast: 0.3,
      saturation: -0.2,
      shadows: { color: '#1b2f6b', amount: 0.35 },
      highlights: { color: '#cfe0ff', amount: 0.25 },
      lift: [0.0, 0.01, 0.03]
    },
    extras: { bloom: true, bloomIntensity: 0.7, bloomThreshold: 0.6, vignette: true, vignetteDarkness: 0.5 }
  },
  {
    id: 'nether',
    label: 'Nether heat',
    hint: 'Fiery reds and ember orange with rich dark shade',
    grade: {
      temperature: 0.35,
      contrast: 0.3,
      vibrance: 0.35,
      shadows: { color: '#5c1010', amount: 0.25 },
      highlights: { color: '#ff8c33', amount: 0.4 },
      gain: [1.05, 0.98, 0.9]
    },
    extras: { bloom: true, bloomIntensity: 0.8, bloomThreshold: 0.65 }
  },
  {
    id: 'frost',
    label: 'Frost',
    hint: 'Icy blue-white air with crisp detail',
    grade: {
      temperature: -0.45,
      exposure: 0.1,
      contrast: 0.25,
      saturation: -0.15,
      highlights: { color: '#e6f6ff', amount: 0.35 },
      shadows: { color: '#2d6f9e', amount: 0.22 },
      lift: [0.01, 0.02, 0.04]
    }
  },
  {
    id: 'horror',
    label: 'Horror',
    hint: 'Sickly green cast, drained colour, deep (but readable) shade',
    grade: {
      tint: -0.35,
      temperature: -0.1,
      exposure: -0.05,
      contrast: 0.35,
      saturation: -0.4,
      shadows: { color: '#1d3b2a', amount: 0.3 },
      highlights: { color: '#d8e6b0', amount: 0.2 }
    },
    extras: { vignette: true, vignetteDarkness: 0.65, grain: true, grainAmount: 0.12 }
  },
  {
    id: 'bleach',
    label: 'Gritty',
    hint: 'Bleach-bypass action look: punchy contrast, metallic muted colour',
    grade: {
      contrast: 0.45,
      saturation: -0.35,
      vibrance: 0.1,
      highlights: { color: '#f2ead8', amount: 0.15 },
      shadows: { color: '#2b3540', amount: 0.3 }
    },
    extras: { grain: true, grainAmount: 0.08, vignette: true, vignetteDarkness: 0.5 }
  }
] satisfies Look[]

export type LookId = (typeof LOOKS)[number]['id']

/** Effect settings that switch a look on at full strength, with its lens and light extras. */
export function lookSettings(id: string): Partial<EffectSettings> & { sunInView?: boolean } {
  const look: Look | undefined = LOOKS.find((l) => l.id === id)
  return look ? { ...look.extras, look: look.id, lookIntensity: 1 } : { look: null }
}

const baked = new Map<string, LookupTexture>()
/** The LUT for a built-in look (baked once, then reused). */
export function lookLut(id: string): LookupTexture | null {
  const look = LOOKS.find((l) => l.id === id)
  if (!look) return null
  let lut = baked.get(id)
  if (!lut) baked.set(id, (lut = bakeLut(look.grade)))
  return lut
}

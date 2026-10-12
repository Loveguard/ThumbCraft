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
// - hue bands nudge one family of colours (greens toward emerald, say) the way film stocks render them;
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
  /**
   * Per-hue tweaks, like a film stock's colour response: colours near `hue` (degrees, 0 red, 120 green,
   * 240 blue) turn by `shift` degrees and gain `sat` saturation (-1 … +1). Greys are never touched.
   */
  hues?: { hue: number; shift?: number; sat?: number; width?: number }[]
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

function rgbToHsv([r, g, b]: RGB): RGB {
  const v = Math.max(r, g, b)
  const d = v - Math.min(r, g, b)
  const s = v > 1e-6 ? d / v : 0
  let h = 0
  if (d > 1e-6) {
    if (v === r) h = ((g - b) / d) % 6
    else if (v === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [(h * 60 + 360) % 360, s, v]
}
function hsvToRgb([h, s, v]: RGB): RGB {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
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

  // Hue bands: turn and saturate one family of colours, keeping each pixel's brightness.
  if (g.hues) {
    const l = luma(c)
    const [h, s, v] = rgbToHsv(c.map((x) => Math.max(0, x)) as RGB)
    let dh = 0
    let ds = 0
    for (const band of g.hues) {
      let d = Math.abs(h - band.hue) % 360
      if (d > 180) d = 360 - d
      const w = Math.exp(-((d / (band.width ?? 35)) ** 2)) * Math.min(1, s * 4)
      dh += (band.shift ?? 0) * w
      ds += (band.sat ?? 0) * w
    }
    c = hsvToRgb([(h + dh + 360) % 360, clamp01(s * (1 + ds)), v])
    const now = luma(c)
    if (now > 1e-4) c = c.map((x) => x * (l / now)) as RGB
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
 * blacks and clean whites; the intensity slider takes any of them from a hint to the full grade. There are
 * only six, and each one changes the picture in its own clearly different way.
 */
export const LOOKS = [
  {
    id: 'fuji',
    label: 'Fuji film',
    hint: 'Fujifilm colour negative: rich but natural colour, emerald greens, deep reds, soft film shoulder and a warm glow',
    grade: {
      temperature: 0.06,
      tint: -0.05,
      contrast: 0.38,
      pivot: 0.42,
      saturation: 0.06,
      vibrance: 0.4,
      hues: [
        { hue: 100, shift: 32, sat: -0.08, width: 45 }, // greens lean cool emerald
        { hue: 215, shift: -12, sat: 0.15 }, // skies lean cyan
        { hue: 25, shift: -4, sat: 0.1, width: 25 }, // skin and wood stay warm
        { hue: 355, shift: -8, sat: 0.2, width: 25 } // reds go deep and slightly magenta
      ],
      shadows: { color: '#1f6f6a', amount: 0.24 },
      highlights: { color: '#ffd9b0', amount: 0.26 },
      fade: 0.04,
      ceiling: 0.97
    },
    extras: {
      bloom: true,
      bloomIntensity: 0.55,
      bloomThreshold: 0.7,
      grain: true,
      grainAmount: 0.06,
      vignette: true,
      vignetteDarkness: 0.3
    }
  },
  {
    id: 'teal-orange',
    label: 'Blockbuster',
    hint: 'Teal and orange: cool teal shade and greens, warm glowing skin and highlights',
    grade: {
      contrast: 0.4,
      vibrance: 0.3,
      hues: [
        { hue: 110, shift: 45, sat: -0.1, width: 45 }, // greens turn teal
        { hue: 25, shift: 4, sat: 0.15 } // skin and wood glow orange
      ],
      shadows: { color: '#1a8a9c', amount: 0.42 },
      highlights: { color: '#ff9a40', amount: 0.42 },
      lift: [0, 0.01, 0.02]
    },
    extras: { vignette: true, vignetteDarkness: 0.4 }
  },
  {
    id: 'night',
    label: 'Moonlight',
    hint: 'Day for night: deep blue shade and silver-blue light that stays readable',
    grade: {
      temperature: -0.6,
      exposure: -0.45,
      contrast: 0.3,
      saturation: -0.3,
      shadows: { color: '#1b2f6b', amount: 0.4 },
      highlights: { color: '#cfe0ff', amount: 0.3 },
      lift: [0.0, 0.01, 0.035]
    },
    extras: { bloom: true, bloomIntensity: 0.7, bloomThreshold: 0.6, vignette: true, vignetteDarkness: 0.5 }
  },
  {
    id: 'noir',
    label: 'Noir',
    hint: 'Black and white: hard contrast and a faint silver tone, for drama and flashbacks',
    grade: {
      saturation: -1,
      contrast: 0.5,
      exposure: 0.05,
      shadows: { color: '#2a3a52', amount: 0.06 },
      highlights: { color: '#fff0d6', amount: 0.05 }
    },
    extras: { grain: true, grainAmount: 0.1, vignette: true, vignetteDarkness: 0.55 }
  },
  {
    id: 'horror',
    label: 'Toxic',
    hint: 'Horror: drained, sickly green with glowing greens and murky shade',
    grade: {
      tint: -0.4,
      temperature: -0.1,
      exposure: -0.05,
      contrast: 0.35,
      saturation: -0.65,
      hues: [{ hue: 115, shift: -28, sat: 1.2, width: 45 }], // anything green turns a glowing, sickly chartreuse
      shadows: { color: '#123a24', amount: 0.35 },
      highlights: { color: '#dcf0a0', amount: 0.3 }
    },
    extras: { vignette: true, vignetteDarkness: 0.65, grain: true, grainAmount: 0.12 }
  },
  {
    id: 'neon',
    label: 'Neon',
    hint: 'Synthwave: magenta shade, electric cyan light, colours pushed to glow',
    grade: {
      tint: 0.3,
      contrast: 0.35,
      vibrance: 0.5,
      saturation: 0.1,
      hues: [
        { hue: 100, shift: 65, width: 55 }, // greens turn cyan
        { hue: 30, shift: -35, sat: 0.2, width: 30 } // oranges turn hot pink
      ],
      shadows: { color: '#8a1fb0', amount: 0.5 },
      highlights: { color: '#3fe6ff', amount: 0.35 },
      lift: [0.02, 0, 0.04]
    },
    extras: { bloom: true, bloomIntensity: 0.9, bloomThreshold: 0.6, chromatic: true, chromaticAmount: 0.0015 }
  }
] satisfies Look[]

/**
 * Looks that were retired when the list was cut to six, and the look that now stands in for each, so saved
 * projects and presets that name them still open with a close match.
 */
export const RETIRED_LOOKS = {
  pop: 'fuji',
  golden: 'fuji',
  'bright-airy': 'fuji',
  film: 'fuji',
  'cinema-cool': 'teal-orange',
  nether: 'teal-orange',
  bleach: 'teal-orange',
  frost: 'night'
} as const satisfies Record<string, (typeof LOOKS)[number]['id']>

export type LookId = (typeof LOOKS)[number]['id'] | keyof typeof RETIRED_LOOKS

/** A look id as it is today: a retired look's id becomes the look that replaced it. */
export function currentLookId(id: string): string {
  return (RETIRED_LOOKS as Record<string, string>)[id] ?? id
}

/** Effect settings that switch a look on at full strength, with its lens and light extras. */
export function lookSettings(id: string): Partial<EffectSettings> & { sunInView?: boolean } {
  const look: Look | undefined = LOOKS.find((l) => l.id === currentLookId(id))
  return look ? { ...look.extras, look: look.id, lookIntensity: 1 } : { look: null }
}

const baked = new Map<string, LookupTexture>()
/** The LUT for a built-in look (baked once, then reused). */
export function lookLut(id: string): LookupTexture | null {
  id = currentLookId(id)
  const look = LOOKS.find((l) => l.id === id)
  if (!look) return null
  let lut = baked.get(id)
  if (!lut) baked.set(id, (lut = bakeLut(look.grade)))
  return lut
}

// Render modes: Vanilla draws the game's own lighting; the others light the scene with a real sun, shadows
// and placed lights, each tuned to a look (a shader pack, Minecraft's cel-shaded key art). Shader looks also add a little post-processing
// underneath the user's own Look (the user's settings always win).
import type { EffectSettings } from './store'

export type RenderMode = 'vanilla' | 'cinematic' | 'soft' | 'cartoon'

export const RENDER_MODES: { id: RenderMode; label: string; hint: string }[] = [
  { id: 'vanilla', label: 'Vanilla', hint: 'Exactly how the game draws it' },
  { id: 'cinematic', label: 'Cinematic', hint: 'A real sun with shadows, plus your placed lights' },
  {
    id: 'soft',
    label: 'Soft',
    hint: 'Warm sun, soft shadows and sky-tinted light (in the spirit of Complementary Reimagined)'
  },
  {
    id: 'cartoon',
    label: 'Cartoon',
    hint: 'Bright, clean cel-shaded colour like Minecraft key art, with crisp shadows and outlines'
  }
]

/** Real lighting (sun, shadows, placed lights): every mode but Vanilla. */
export const isLit = (mode: RenderMode): boolean => mode !== 'vanilla'

export interface Lighting {
  /** Sun (directional light) strength and colour. */
  sun: number
  sunColor: string
  /** Flat ambient light. */
  ambient: number
  /** Sky-above / ground-below light, the soft bounce shader packs give shaded sides. */
  hemisphere: number
  skyColor: string
  groundColor: string
  /** The faint second light that keeps the far side of things from going black. */
  fill: number
  /** Shadow edge softness (shadow map blur radius). */
  shadowSoftness: number
}

export const LIGHTING: Record<Exclude<RenderMode, 'vanilla'>, Lighting> = {
  cinematic: {
    sun: 2.2,
    sunColor: '#ffffff',
    ambient: 0.9,
    hemisphere: 0,
    skyColor: '#ffffff',
    groundColor: '#ffffff',
    fill: 0.3,
    shadowSoftness: 1
  },
  soft: {
    sun: 2.1,
    sunColor: '#ffe2b4',
    ambient: 0.35,
    hemisphere: 1,
    skyColor: '#a8ccff',
    groundColor: '#8c6c48',
    fill: 0.22,
    shadowSoftness: 7
  },
  // Key art: a strong clean sun with crisp shadows, and shade filled with bright sky-blue light so it
  // never goes muddy.
  cartoon: {
    sun: 2.0,
    sunColor: '#fff6e0',
    ambient: 0.55,
    hemisphere: 1.1,
    skyColor: '#cfe9ff',
    groundColor: '#a7c27a',
    fill: 0.3,
    shadowSoftness: 1.5
  }
}

/** Post-processing a shader look adds when the user's Look leaves that part off. */
const POST: Partial<Record<RenderMode, Partial<EffectSettings>>> = {
  soft: {
    bloom: true,
    bloomIntensity: 0.35,
    bloomThreshold: 0.85,
    saturation: 0.12,
    contrast: 0.06,
    temperature: 0.08,
    vignette: true,
    vignetteDarkness: 0.3
  },
  cartoon: {
    bloom: true,
    bloomIntensity: 0.3,
    bloomThreshold: 0.9,
    saturation: 0.1,
    contrast: 0.1,
    temperature: 0.03
  }
}

/**
 * The effects actually drawn: the user's Look, with the shader look's bloom and vignette filling in where the
 * user has them off, and its colour nudges added on top of the user's grade.
 */
export function withShaderLook(e: EffectSettings, mode: RenderMode): EffectSettings {
  const post = POST[mode]
  if (!post) return e
  const out = { ...e }
  if (!e.bloom && post.bloom)
    Object.assign(out, { bloom: true, bloomIntensity: post.bloomIntensity, bloomThreshold: post.bloomThreshold })
  if (!e.vignette && post.vignette) Object.assign(out, { vignette: true, vignetteDarkness: post.vignetteDarkness })
  for (const k of ['saturation', 'contrast', 'temperature'] as const) out[k] = e[k] + (post[k] ?? 0)
  return out
}

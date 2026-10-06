// Fonts and one-click title styles for thumbnail text. The bundled fonts are open-licensed (SIL OFL /
// Apache 2.0) and ship with the app, so text looks the same on every computer; users can add their own
// .ttf/.otf/.woff files, which are saved inside the project.
import '@fontsource/anton/latin-400.css'
import '@fontsource/bebas-neue/latin-400.css'
import '@fontsource/bungee/latin-400.css'
import '@fontsource/lilita-one/latin-400.css'
import '@fontsource/luckiest-guy/latin-400.css'
import '@fontsource/russo-one/latin-400.css'
import '@fontsource/titan-one/latin-400.css'
import { mediaStore } from './media'
import type { TextObject } from './store'

export interface FontChoice {
  label: string
  /** CSS font-family list. */
  family: string
  /** Display fonts come in one weight; Impact (a system font) is drawn extra bold. */
  weight: 'normal' | '900'
}

export const FONTS: FontChoice[] = [
  { label: 'Impact', family: 'Impact, "Anton", "Arial Black", sans-serif', weight: '900' },
  { label: 'Anton', family: '"Anton", Impact, sans-serif', weight: 'normal' },
  { label: 'Luckiest Guy', family: '"Luckiest Guy", "Titan One", sans-serif', weight: 'normal' },
  { label: 'Titan One', family: '"Titan One", sans-serif', weight: 'normal' },
  { label: 'Lilita One', family: '"Lilita One", sans-serif', weight: 'normal' },
  { label: 'Bebas Neue', family: '"Bebas Neue", Impact, sans-serif', weight: 'normal' },
  { label: 'Bungee', family: '"Bungee", sans-serif', weight: 'normal' },
  { label: 'Russo One', family: '"Russo One", sans-serif', weight: 'normal' }
]

/** Family name a user-imported font is registered under. */
export const customFamily = (mediaId: string): string => `"tc-font-${mediaId}"`

/** The canvas font weight for a text object's font. */
export function fontWeight(o: Pick<TextObject, 'font' | 'fontMediaId'>): string {
  if (o.fontMediaId) return 'normal'
  return FONTS.find((f) => f.family === o.font)?.weight ?? '900'
}

const registered = new Map<string, Promise<void>>()

/**
 * Makes sure the text's font is ready to draw on a canvas: bundled fonts load lazily, imported fonts are
 * registered from the project's media. Resolves even if the font fails (the fallback font is used).
 */
export function ensureFont(o: Pick<TextObject, 'font' | 'fontMediaId'>): Promise<void> {
  const key = o.fontMediaId ?? o.font
  let p = registered.get(key)
  if (!p) {
    p = (async () => {
      if (o.fontMediaId) {
        const m = mediaStore.get(o.fontMediaId)
        if (!m) return
        const face = new FontFace(customFamily(o.fontMediaId).replace(/"/g, ''), m.bytes.slice().buffer)
        await face.load()
        document.fonts.add(face)
      } else {
        await document.fonts.load(`${fontWeight(o)} 160px ${o.font}`)
      }
    })().catch(() => undefined)
    registered.set(key, p)
  }
  return p
}

type Style = Pick<
  TextObject,
  'color' | 'outlineColor' | 'outlineWidth' | 'shadow' | 'gradient' | 'outline2Color' | 'outline2Width' | 'glow'
> & { font?: string }

const BASE: Style = {
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 14,
  shadow: true,
  gradient: null,
  outline2Color: '#000000',
  outline2Width: 0,
  glow: null
}

/** One-click looks for title text (keeps the words, the size and the position). */
export const TEXT_STYLES: { name: string; preview: string; style: Style }[] = [
  { name: 'Classic', preview: 'linear-gradient(#ffe14d,#ffe14d)', style: { ...BASE, color: '#ffe14d' } },
  {
    name: 'Fire',
    preview: 'linear-gradient(#ffe85c,#ff3b1f)',
    style: { ...BASE, color: '#ffe85c', gradient: '#ff3b1f', outline2Width: 8, outline2Color: '#5a0d00' }
  },
  {
    name: 'Ice',
    preview: 'linear-gradient(#ffffff,#5fd4ff)',
    style: { ...BASE, color: '#ffffff', gradient: '#5fd4ff', outlineColor: '#0b2a5c', glow: '#7fe0ff' }
  },
  {
    name: 'Gold',
    preview: 'linear-gradient(#fff3a6,#d98c00)',
    style: { ...BASE, color: '#fff3a6', gradient: '#d98c00', outlineColor: '#4a2c00', outline2Width: 6 }
  },
  {
    name: 'Neon',
    preview: 'linear-gradient(#ffffff,#ff4fd8)',
    style: { ...BASE, color: '#ffffff', outlineColor: '#ff2bd1', outlineWidth: 6, shadow: false, glow: '#ff2bd1' }
  },
  {
    name: 'Toxic',
    preview: 'linear-gradient(#d4ff4f,#21b04b)',
    style: { ...BASE, color: '#d4ff4f', gradient: '#21b04b', outline2Width: 8 }
  },
  {
    name: 'Bold white',
    preview: 'linear-gradient(#ffffff,#ffffff)',
    style: { ...BASE, color: '#ffffff', outlineWidth: 18, outline2Color: '#ff2b2b', outline2Width: 8 }
  },
  {
    name: 'Horror',
    preview: 'linear-gradient(#ff4444,#5c0000)',
    style: { ...BASE, color: '#ff4444', gradient: '#5c0000', glow: '#ff0000', shadow: false }
  },
  {
    name: 'Diamond',
    preview: 'linear-gradient(#b8fff4,#1fbfb0)',
    style: { ...BASE, color: '#b8fff4', gradient: '#1fbfb0', outlineColor: '#06323a', outline2Width: 6 }
  }
]

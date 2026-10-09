// The thumbnail kit: arrows, circles, X and check marks, a "!" burst and a highlight box. They're flat 2D layers
// placed on the frame itself (not in the 3D scene), drawn after every effect, so they stay crisp and stay where you
// put them whatever the camera does. The same SVG draws them in the viewport and in exports.
import type { StickerObject } from './store'

export type StickerShape = 'arrow' | 'arrow-curve' | 'circle' | 'cross' | 'check' | 'burst' | 'box'

export const STICKERS: { id: StickerShape; label: string; color: string }[] = [
  { id: 'arrow', label: 'Arrow', color: '#ff2a2a' },
  { id: 'arrow-curve', label: 'Curved arrow', color: '#ff2a2a' },
  { id: 'circle', label: 'Circle', color: '#ff2a2a' },
  { id: 'cross', label: 'X mark', color: '#ff2a2a' },
  { id: 'check', label: 'Check', color: '#22c55e' },
  { id: 'burst', label: '"!" burst', color: '#ffd23a' },
  { id: 'box', label: 'Highlight box', color: '#ffd23a' }
]

/** Colours offered as one-click swatches. */
export const STICKER_SWATCHES = ['#ff2a2a', '#ffd23a', '#22c55e', '#3b82f6', '#ffffff', '#111111']

const safeColor = (c: string): string => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#ff2a2a')

/** One closed, filled outline or one or more open strokes, in a 100 × 100 box. */
const SHAPES: Record<StickerShape, { fill?: string; stroke?: string[]; width?: number; extra?: string }> = {
  arrow: { fill: 'M6 40 L58 40 L58 20 L95 50 L58 80 L58 60 L6 60 Z' },
  'arrow-curve': {
    stroke: ['M12 86 C 14 50 32 32 66 30'],
    width: 11,
    fill: 'M60 12 L94 30 L60 48 Z'
  },
  circle: {
    stroke: ['M52 10 C 84 10 95 34 92 54 C 89 80 58 92 33 86 C 10 80 4 52 16 32 C 26 15 46 9 70 15'],
    width: 7
  },
  cross: { stroke: ['M18 18 L82 82', 'M82 18 L18 82'], width: 15 },
  check: { stroke: ['M14 54 L40 80 L88 22'], width: 15 },
  burst: {
    fill:
      'M50 2 L59 26 L82 12 L76 37 L98 44 L78 58 L92 80 L66 75 L64 98 L50 80 L36 98 L34 75 L8 80 L22 58 L2 44 ' +
      'L24 37 L18 12 L41 26 Z',
    extra: '<path d="M45 28 L55 28 L53 60 L47 60 Z" fill="#fff"/><circle cx="50" cy="70" r="5.5" fill="#fff"/>'
  },
  box: {
    stroke: ['M10 22 H90 A6 6 0 0 1 96 28 V72 A6 6 0 0 1 90 78 H10 A6 6 0 0 1 4 72 V28 A6 6 0 0 1 10 22 Z'],
    width: 6
  }
}

/** The sticker as a standalone SVG document (square, 100 units across). */
export function stickerSvg(o: Pick<StickerObject, 'shape' | 'color' | 'outline' | 'glow'>): string {
  const shape = SHAPES[o.shape] ?? SHAPES.arrow
  const color = safeColor(o.color)
  const w = shape.width ?? 0
  // A dark drop shadow keeps it readable on any background; glow swaps it for a halo in its own colour.
  const filter = o.glow
    ? `<feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="${color}" flood-opacity="0.95"/>`
    : `<feDropShadow dx="1.5" dy="2.5" stdDeviation="1.6" flood-color="#000" flood-opacity="0.55"/>`
  const parts: string[] = []
  if (shape.stroke)
    for (const d of shape.stroke) {
      if (o.outline)
        parts.push(
          `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w + 7}" stroke-linecap="round" stroke-linejoin="round"/>`
        )
      parts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    }
  if (shape.fill)
    parts.push(
      `<path d="${shape.fill}" fill="${color}"${o.outline ? ' stroke="#fff" stroke-width="5" paint-order="stroke"' : ''} stroke-linejoin="round"/>`
    )
  if (shape.extra) parts.push(shape.extra)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="112" height="112">` +
    `<defs><filter id="f" x="-20%" y="-20%" width="140%" height="140%">${filter}</filter></defs>` +
    `<g filter="url(#f)">${parts.join('')}</g></svg>`
  )
}

const images = new Map<string, Promise<HTMLImageElement>>()
/** The sticker as an image, for drawing into an export. */
export function stickerImage(o: StickerObject): Promise<HTMLImageElement> {
  const svg = stickerSvg(o)
  let p = images.get(svg)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not draw a sticker'))
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    images.set(svg, p)
  }
  return p
}

/**
 * Draws the stickers over a rendered frame. Each sits at (x, y) as fractions of the frame (`position[0..1]`),
 * `scale` of the frame's height tall, turned `rotation[2]` degrees, mirrored when `flip` is set.
 */
export async function drawStickers(
  g: CanvasRenderingContext2D,
  list: StickerObject[],
  w: number,
  h: number
): Promise<void> {
  for (const o of list) {
    const img = await stickerImage(o)
    const size = o.scale * h * (112 / 100)
    g.save()
    g.translate(o.position[0] * w, o.position[1] * h)
    g.rotate((o.rotation[2] * Math.PI) / 180)
    if (o.flip) g.scale(-1, 1)
    g.drawImage(img, -size / 2, -size / 2, size, size)
    g.restore()
  }
}

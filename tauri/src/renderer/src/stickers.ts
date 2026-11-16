// The thumbnail kit: arrows, circles, X and check marks, a "!" burst and a highlight box. They're flat 2D layers
// placed on the frame itself (not in the 3D scene), drawn after every effect, so they stay crisp and stay where you
// put them whatever the camera does. The same SVG draws them in the viewport and in exports.
//
// Shapes are built from their settings: line thickness (`weight`) for every shape but the burst, and `stretch`,
// which is the tail length of an arrow and the width of a circle or box. A shape's size is measured in units where
// 100 units are `scale` of the frame's height.
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

/** What the stretch slider is called for a shape, or null when the shape has none. */
export const stretchLabel = (shape: StickerShape): string | null =>
  shape === 'arrow' || shape === 'arrow-curve' ? 'Tail length' : shape === 'circle' || shape === 'box' ? 'Width' : null

/** Whether a shape has a line thickness. */
export const hasWeight = (shape: StickerShape): boolean => shape !== 'burst'

const safeColor = (c: string): string => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#ff2a2a')
const n = (v: number): string => (Math.round(v * 100) / 100).toString()

interface Geometry {
  /** Open strokes, all drawn `width` thick. */
  strokes: string[]
  width: number
  /** Closed, filled outlines. */
  fills: string[]
  /** Markup drawn last, unchanged by the outline (the burst's "!"). */
  extra?: string
  /** Bounds of the shape's centre lines: [minX, minY, maxX, maxY]. */
  box: [number, number, number, number]
}

const clamp = (v: number | undefined, lo: number, hi: number, d = 1): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? (v as number) : d))

function geometry(o: Pick<StickerObject, 'shape' | 'weight' | 'stretch'>): Geometry {
  const t = clamp(o.weight, 0.3, 3)
  const k = clamp(o.stretch, 0.4, 3)
  switch (o.shape) {
    case 'arrow-curve': {
      // A swoosh ending in a head at (66, 30); a longer tail starts further back along the same bend.
      const w = 11 * t
      const head = 18 + 4 * t
      const sx = 66 - 54 * k
      const sy = 30 + 56 * k
      const c1 = [66 - 52 * k, 30 + 20 * k]
      const c2 = [66 - 34 * k, 30 + 2 * k]
      return {
        strokes: [`M${n(sx)} ${n(sy)} C ${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} 64 30`],
        width: w,
        fills: [`M60 ${n(30 - head)} L${n(60 + head * 1.9)} 30 L60 ${n(30 + head)} Z`],
        box: [Math.min(sx, c1[0]) - w / 2, 30 - head, 60 + head * 1.9, sy + w / 2]
      }
    }
    case 'circle': {
      // Hand-drawn: one loop that overshoots where it started, slightly wobbly.
      const rx = 44 * k
      const ry = 40
      const pts: string[] = []
      const steps = 56
      for (let i = 0; i <= steps; i++) {
        const a = ((-100 + (i / steps) * 400) * Math.PI) / 180
        const r = 1 + 0.035 * Math.sin(a * 3 + 0.6) + (i / steps) * 0.06
        pts.push(`${n(rx * r * Math.cos(a))} ${n(ry * r * Math.sin(a))}`)
      }
      const w = 7 * t
      return { strokes: [`M${pts.join(' L')}`], width: w, fills: [], box: [-rx * 1.1, -ry * 1.1, rx * 1.1, ry * 1.1] }
    }
    case 'cross':
      return { strokes: ['M18 18 L82 82', 'M82 18 L18 82'], width: 15 * t, fills: [], box: [18, 18, 82, 82] }
    case 'check':
      return { strokes: ['M14 54 L40 80 L88 22'], width: 15 * t, fills: [], box: [14, 22, 88, 80] }
    case 'burst':
      return {
        strokes: [],
        width: 0,
        fills: [
          'M50 2 L59 26 L82 12 L76 37 L98 44 L78 58 L92 80 L66 75 L64 98 L50 80 L36 98 L34 75 L8 80 L22 58 L2 44 ' +
            'L24 37 L18 12 L41 26 Z'
        ],
        extra: '<path d="M45 28 L55 28 L53 60 L47 60 Z" fill="#fff"/><circle cx="50" cy="70" r="5.5" fill="#fff"/>',
        box: [2, 2, 98, 98]
      }
    case 'box': {
      const hw = 46 * k
      const r = 6
      return {
        strokes: [
          `M${n(-hw + r)} -28 H${n(hw - r)} A${r} ${r} 0 0 1 ${n(hw)} -22 V22 A${r} ${r} 0 0 1 ${n(hw - r)} 28 ` +
            `H${n(-hw + r)} A${r} ${r} 0 0 1 ${n(-hw)} 22 V-22 A${r} ${r} 0 0 1 ${n(-hw + r)} -28 Z`
        ],
        width: 6 * t,
        fills: [],
        box: [-hw, -28, hw, 28]
      }
    }
    default: {
      // Straight arrow pointing right: a shaft `tail` long, then the head. Thicker arrows get a bigger head.
      const shaft = 10 * t
      const half = Math.max(30, shaft + 14)
      const headLen = half * 1.2
      const tail = 52 * k
      return {
        strokes: [],
        width: 0,
        fills: [
          `M0 ${n(-shaft)} L${n(tail)} ${n(-shaft)} L${n(tail)} ${n(-half)} L${n(tail + headLen)} 0 ` +
            `L${n(tail)} ${n(half)} L${n(tail)} ${n(shaft)} L0 ${n(shaft)} Z`
        ],
        box: [0, -half, tail + headLen, half]
      }
    }
  }
}

export interface StickerArt {
  svg: string
  /** Size of the drawing in shape units (100 units = `scale` of the frame's height). */
  width: number
  height: number
}

/** The sticker as a standalone SVG document, sized to fit the shape. */
export function stickerArt(
  o: Pick<StickerObject, 'shape' | 'color' | 'outline' | 'glow' | 'weight' | 'stretch'>
): StickerArt {
  const g = geometry(o)
  const color = safeColor(o.color)
  // Room around the centre lines for the line itself, the white outline and the shadow or glow.
  const pad = g.width / 2 + (o.outline ? 4 : 0) + 7
  const [x0, y0, x1, y1] = [g.box[0] - pad, g.box[1] - pad, g.box[2] + pad, g.box[3] + pad]
  const width = x1 - x0
  const height = y1 - y0
  // A dark drop shadow keeps it readable on any background; glow swaps it for a halo in its own colour.
  const filter = o.glow
    ? `<feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="${color}" flood-opacity="0.95"/>`
    : `<feDropShadow dx="1.5" dy="2.5" stdDeviation="1.6" flood-color="#000" flood-opacity="0.55"/>`
  const line = 'stroke-linecap="round" stroke-linejoin="round"'
  const parts: string[] = []
  for (const d of g.strokes) {
    if (o.outline) parts.push(`<path d="${d}" fill="none" stroke="#fff" stroke-width="${n(g.width + 7)}" ${line}/>`)
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(g.width)}" ${line}/>`)
  }
  for (const d of g.fills)
    parts.push(
      `<path d="${d}" fill="${color}"${o.outline ? ' stroke="#fff" stroke-width="5" paint-order="stroke"' : ''} stroke-linejoin="round"/>`
    )
  if (g.extra) parts.push(g.extra)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x0)} ${n(y0)} ${n(width)} ${n(height)}" ` +
    `width="${n(width)}" height="${n(height)}">` +
    `<defs><filter id="f" x="-20%" y="-20%" width="140%" height="140%">${filter}</filter></defs>` +
    `<g filter="url(#f)">${parts.join('')}</g></svg>`
  return { svg, width, height }
}

/** Just the SVG markup (for buttons and previews). */
export const stickerSvg = (o: Parameters<typeof stickerArt>[0]): string => stickerArt(o).svg

const images = new Map<string, Promise<HTMLImageElement>>()
/** The sticker as an image, for drawing into an export. */
function stickerImage(svg: string): Promise<HTMLImageElement> {
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
 * Draws the stickers over a rendered frame. Each is centred at (x, y) as fractions of the frame (`position[0..1]`),
 * 100 shape units are `scale` of the frame's height, turned `rotation[2]` degrees, mirrored when `flip` is set.
 */
export async function drawStickers(
  g: CanvasRenderingContext2D,
  list: StickerObject[],
  w: number,
  h: number
): Promise<void> {
  for (const o of list) {
    const art = stickerArt(o)
    const img = await stickerImage(art.svg)
    const unit = (o.scale * h) / 100
    const [dw, dh] = [art.width * unit, art.height * unit]
    g.save()
    g.translate(o.position[0] * w, o.position[1] * h)
    g.rotate((o.rotation[2] * Math.PI) / 180)
    if (o.flip) g.scale(-1, 1)
    g.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    g.restore()
  }
}

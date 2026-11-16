// The finished thumbnail as exported: the 3D render (with its effects), then the 2D thumbnail-kit layers on top.
// Also renders the other open projects (tabs), for split images and the YouTube preview.
import { building, viewport } from './components/Viewport'
import { decodeImage } from './image'
import { drawStickers } from './stickers'
import { flushAutosave } from './projectActions'
import { useStore, type SplitSettings, type StickerObject } from './store'
import { switchTab, useTabs } from './tabs'

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** The thumbnail of the shot on screen at `w`×`h`, as a PNG data URL: the 3D render, then its stickers. */
export async function captureFrame(w: number, h: number): Promise<string> {
  if (!viewport.capture) throw new Error('The viewport is not ready yet')
  // Titles redraw once their font has loaded; never export one mid-swap.
  await document.fonts.ready
  const png = viewport.capture(w, h)
  const s = useStore.getState()
  const stickers = s.objects.filter((o): o is StickerObject => o.kind === 'sticker' && o.visible)
  if (!stickers.length) return png
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.drawImage(await decodeImage(png, 'Could not draw the export'), 0, 0, w, h)
  await drawStickers(g, stickers, w, h)
  return c.toDataURL('image/png')
}

/** Waits until everything in the scene on screen has been built and drawn (or 30 s, whichever comes first). */
export async function sceneSettled(): Promise<void> {
  const until = performance.now() + 30_000
  let quiet = 0
  while (quiet < 3 && performance.now() < until) {
    await nextFrame()
    quiet = building.count === 0 ? quiet + 1 : 0
  }
}

/**
 * Shows each open project (tab) in turn and runs `fn` once its scene is built, then goes back to the tab you were
 * on. One run at a time: two overlapping runs would switch tabs under each other and capture the wrong one.
 */
export function eachTab<T>(keys: string[], fn: (key: string) => Promise<T>): Promise<T[]> {
  const run = queue.then(() => tabByTab(keys, fn))
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
let queue: Promise<void> = Promise.resolve()

async function tabByTab<T>(keys: string[], fn: (key: string) => Promise<T>): Promise<T[]> {
  // Pending edits go into this project's recovery copy before other projects come on screen.
  await flushAutosave()
  const back = useTabs.getState().active
  const out: T[] = []
  try {
    for (const key of keys) {
      if (key !== useTabs.getState().active) switchTab(key)
      await sceneSettled()
      out.push(await fn(key))
    }
  } finally {
    switchTab(back)
  }
  return out
}

/** Tiny seeded random, so a torn edge or a bolt looks the same in every export. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Two renders in one image: `left` fills the frame, `right` shows past the divider, and the divider is drawn over
 * the seam (a straight line, a strip of torn paper or a lightning bolt).
 */
export async function composeSplit(
  left: string,
  right: string,
  w: number,
  h: number,
  sp: SplitSettings
): Promise<string> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const [a, b] = await Promise.all([
    decodeImage(left, 'Could not draw the split'),
    decodeImage(right, 'Could not draw the split')
  ])
  const lean = Math.tan((sp.angle * Math.PI) / 180)
  const xAt = (y: number): number => sp.position * w + (y - h / 2) * lean
  g.drawImage(a, 0, 0, w, h)
  g.save()
  g.beginPath()
  g.moveTo(xAt(0), 0)
  g.lineTo(w, 0)
  g.lineTo(w, h)
  g.lineTo(xAt(h), h)
  g.closePath()
  g.clip()
  g.drawImage(b, 0, 0, w, h)
  g.restore()

  const rnd = random(7)
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  if (sp.style === 'straight') {
    g.shadowColor = 'rgba(0,0,0,0.6)'
    g.shadowBlur = h * 0.02
    g.strokeStyle = sp.color
    g.lineWidth = h * 0.014
    g.beginPath()
    g.moveTo(xAt(-10), -10)
    g.lineTo(xAt(h + 10), h + 10)
    g.stroke()
  } else if (sp.style === 'torn') {
    // A strip of paper along the seam with ragged edges on both sides.
    const band = h * 0.026
    const steps = 46
    const edge = (side: number): [number, number][] =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const y = -h * 0.05 + (i / steps) * h * 1.1
        return [xAt(y) + side * (band / 2) + side * (rnd() - 0.3) * band * 0.7, y]
      })
    const l = edge(-1)
    const r = edge(1).reverse()
    g.shadowColor = 'rgba(0,0,0,0.55)'
    g.shadowBlur = h * 0.025
    g.fillStyle = '#f3efe6'
    g.beginPath()
    for (const [i, [x, y]] of [...l, ...r].entries()) i ? g.lineTo(x, y) : g.moveTo(x, y)
    g.closePath()
    g.fill()
  } else {
    // A zig-zag bolt glowing in its colour, with a white-hot core.
    const pts: [number, number][] = []
    const steps = 9
    for (let i = 0; i <= steps; i++) {
      const y = -h * 0.04 + (i / steps) * h * 1.08
      const swing = i % 2 ? 1 : -1
      pts.push([xAt(y) + swing * h * (0.025 + rnd() * 0.02), y])
    }
    const path = (): void => {
      g.beginPath()
      for (const [i, [x, y]] of pts.entries()) i ? g.lineTo(x, y) : g.moveTo(x, y)
    }
    g.shadowColor = sp.color
    g.shadowBlur = h * 0.05
    g.strokeStyle = sp.color
    g.lineWidth = h * 0.016
    path()
    g.stroke()
    g.shadowBlur = 0
    g.strokeStyle = '#ffffff'
    g.lineWidth = h * 0.006
    path()
    g.stroke()
  }
  g.restore()
  return c.toDataURL('image/png')
}

/** The split image at `w`×`h`, rendering both projects. */
export async function captureSplit(w: number, h: number, sp: SplitSettings): Promise<string> {
  const [left, right] = await eachTab([sp.left, sp.right], () => captureFrame(w, h))
  return composeSplit(left, right, w, h, sp)
}

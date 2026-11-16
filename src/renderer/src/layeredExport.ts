// Layered export for Photoshop: the background (sky and terrain), one layer per player, mob, build, title and
// effect, one per sticker, and the flattened thumbnail on top (hidden). Each 3D layer is the part of the finished
// frame (effects included) that changes when that one object is hidden, so stacking the layers gives the frame back.
import { writePsdUint8Array, type Layer } from 'ag-psd'
import * as THREE from 'three'
import { sceneSettled } from './capture'
import { viewport } from './components/Viewport'
import { drawStickers } from './stickers'
import { useStore, type SceneObject, type StickerObject } from './store'

/** Objects that get a layer of their own (the ground, lights and helpers stay in the background). */
const own = (o: SceneObject): boolean =>
  o.visible && o.kind !== 'light' && o.kind !== 'sticker' && !(o.kind === 'terrain' && o.ground)

/** How different two pixels must be (0–255 per channel) to count as the object's: skips faint bloom far away. */
const THRESHOLD = 6

function canvasOf(data: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = data.width
  c.height = data.height
  c.getContext('2d')!.putImageData(data, 0, 0)
  return c
}

/** The pixels of `full` that differ from `without`, cropped to where they are (null when nothing differs). */
function cutOut(full: ImageData, without: ImageData): { data: ImageData; left: number; top: number } | null {
  const { width: w, height: h } = full
  const a = full.data
  const b = without.data
  const out = new ImageData(w, h)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
      if (d < THRESHOLD) continue
      out.data[i] = a[i]
      out.data[i + 1] = a[i + 1]
      out.data[i + 2] = a[i + 2]
      out.data[i + 3] = 255
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  if (x1 < 0) return null
  const crop = document.createElement('canvas').getContext('2d')!
  crop.canvas.width = w
  crop.canvas.height = h
  crop.putImageData(out, 0, 0)
  return { data: crop.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1), left: x0, top: y0 }
}

/** A finished thumbnail at w×h as a layered .psd file. */
export async function layeredPsd(w: number, h: number): Promise<Uint8Array> {
  if (!viewport.captureLayers || !viewport.camera) throw new Error('The viewport is not ready yet')
  await document.fonts.ready
  await sceneSettled()
  const s = useStore.getState()
  const objects = s.objects.filter(own)
  // Far things first, so in Photoshop the nearer object's layer sits above.
  const cam = viewport.camera.position
  const dist = (id: string): number =>
    viewport.objects.get(id)?.getWorldPosition(new THREE.Vector3()).distanceTo(cam) ?? 0
  objects.sort((a, b) => dist(b.id) - dist(a.id))
  const cap = viewport.captureLayers(
    w,
    h,
    objects.map((o) => o.id)
  )

  const layers: Layer[] = []
  const background = new ImageData(new Uint8ClampedArray(cap.background.data), w, h)
  const stack = canvasOf(background).getContext('2d')!
  for (const o of objects) {
    const without = cap.without.find((x) => x.id === o.id)
    const cut = without && cutOut(cap.full, without.pixels)
    if (!cut) continue
    const canvas = canvasOf(cut.data)
    stack.drawImage(canvas, cut.left, cut.top)
    layers.push({ name: o.name, canvas, left: cut.left, top: cut.top })
  }
  // Where the stacked layers still differ from the frame (two objects sharing a shadow, faint glows), the frame's
  // own pixels go into the background, so the layers always add up to exactly the thumbnail.
  const stacked = stack.getImageData(0, 0, w, h).data
  const full = cap.full.data
  for (let i = 0; i < full.length; i += 4)
    if (stacked[i] !== full[i] || stacked[i + 1] !== full[i + 1] || stacked[i + 2] !== full[i + 2])
      for (let k = 0; k < 4; k++) background.data[i + k] = full[i + k]

  const stickers = s.objects.filter((o): o is StickerObject => o.kind === 'sticker' && o.visible)
  const flat = canvasOf(cap.full)
  for (const st of stickers) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    await drawStickers(c.getContext('2d')!, [st], w, h)
    flat.getContext('2d')!.drawImage(c, 0, 0)
    layers.push({ name: st.name, canvas: c })
  }

  return writePsdUint8Array({
    width: w,
    height: h,
    canvas: flat,
    children: [
      { name: 'Background (sky and terrain)', canvas: canvasOf(background) },
      ...layers,
      { name: 'Flattened thumbnail', canvas: flat, hidden: true }
    ]
  })
}

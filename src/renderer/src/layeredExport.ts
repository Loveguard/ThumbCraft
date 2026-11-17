// Layered export for Photoshop: the sky, the terrain, then one layer per build, mob, player, effect and title, each
// kind in its own folder, one layer per sticker, and the flattened thumbnail on top (hidden). Each 3D layer is the
// part of the finished frame (effects included) that changes when that one object is hidden, so stacking the layers
// gives the frame back.
import { writePsdUint8Array, type Layer } from 'ag-psd'
import * as THREE from 'three'
import { sceneSettled } from './capture'
import { viewport } from './components/Viewport'
import { drawStickers } from './stickers'
import { useStore, type SceneObject, type StickerObject } from './store'

/** Objects that get a layer of their own (the ground, lights and helpers stay in the background). */
const own = (o: SceneObject): boolean =>
  o.visible && o.kind !== 'light' && o.kind !== 'sticker' && !(o.kind === 'terrain' && o.ground)

/** The folder each kind of layer goes in, bottom to top as Photoshop stacks them. */
const FOLDERS: [string, SceneObject['kind'][]][] = [
  ['Builds', ['terrain', 'model']],
  ['Mobs', ['mob']],
  ['Players', ['player']],
  ['Effects', ['vfx', 'lightning']],
  ['Images', ['image', 'video', 'mirror']],
  ['Text', ['text', 'pixelText']]
]

/** How different two pixels must be (0–255 per channel) to count as the object's: skips faint bloom far away. */
const THRESHOLD = 6

function canvasOf(data: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = data.width
  c.height = data.height
  c.getContext('2d')!.putImageData(data, 0, 0)
  return c
}

/**
 * The pixels of `full` that differ from `without`, cropped to where they are unless `crop` is false (null when
 * nothing differs).
 */
function cutOut(
  full: ImageData,
  without: ImageData,
  crop = true
): { data: ImageData; left: number; top: number } | null {
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
  if (!crop) return { data: out, left: 0, top: 0 }
  const box = document.createElement('canvas').getContext('2d')!
  box.canvas.width = w
  box.canvas.height = h
  box.putImageData(out, 0, 0)
  return { data: box.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1), left: x0, top: y0 }
}

/** A finished thumbnail at w×h as a layered .psd file. */
export async function layeredPsd(w: number, h: number): Promise<Uint8Array> {
  if (!viewport.captureLayers || !viewport.camera) throw new Error('The viewport is not ready yet')
  await document.fonts.ready
  await sceneSettled()
  const s = useStore.getState()
  const objects = s.objects.filter(own)
  const ground = s.objects.filter((o) => o.visible && o.kind === 'terrain' && o.ground).map((o) => o.id)
  // Far things first, so in Photoshop the nearer object's layer sits above.
  const cam = viewport.camera.position
  const dist = (id: string): number =>
    viewport.objects.get(id)?.getWorldPosition(new THREE.Vector3()).distanceTo(cam) ?? 0
  objects.sort((a, b) => dist(b.id) - dist(a.id))
  const cap = viewport.captureLayers(
    w,
    h,
    objects.map((o) => o.id),
    ground
  )

  // The bottom layer is the sky; the terrain is what the ground adds to it. Without ground it is all one layer.
  const sky = cap.sky ?? new ImageData(new Uint8ClampedArray(cap.background.data), w, h)
  const terrain = cap.sky ? (cutOut(cap.background, cap.sky, false)?.data ?? new ImageData(w, h)) : null
  const stack = canvasOf(sky).getContext('2d')!
  if (terrain) stack.drawImage(canvasOf(terrain), 0, 0)
  const cuts = new Map<string, Layer>()
  for (const o of objects) {
    const without = cap.without.find((x) => x.id === o.id)
    const cut = without && cutOut(cap.full, without.pixels)
    if (!cut) continue
    const canvas = canvasOf(cut.data)
    stack.drawImage(canvas, cut.left, cut.top)
    cuts.set(o.id, { name: o.name, canvas, left: cut.left, top: cut.top })
  }
  // Where the stacked layers still differ from the frame (two objects sharing a shadow, faint glows), the frame's
  // own pixels go into the terrain (or the sky), so the layers always add up to exactly the thumbnail.
  const fix = terrain ?? sky
  const stacked = stack.getImageData(0, 0, w, h).data
  const full = cap.full.data
  for (let i = 0; i < full.length; i += 4)
    if (stacked[i] !== full[i] || stacked[i + 1] !== full[i + 1] || stacked[i + 2] !== full[i + 2])
      for (let k = 0; k < 4; k++) fix.data[i + k] = full[i + k]

  // Each kind in its folder, nearer objects above farther ones inside it.
  const layers: Layer[] = []
  for (const [name, kinds] of FOLDERS) {
    const children = objects.filter((o) => kinds.includes(o.kind) && cuts.has(o.id)).map((o) => cuts.get(o.id)!)
    if (children.length) layers.push({ name, opened: true, children })
  }
  const stickerLayers: Layer[] = []

  const stickers = s.objects.filter((o): o is StickerObject => o.kind === 'sticker' && o.visible)
  const flat = canvasOf(cap.full)
  for (const st of stickers) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    await drawStickers(c.getContext('2d')!, [st], w, h)
    flat.getContext('2d')!.drawImage(c, 0, 0)
    stickerLayers.push({ name: st.name, canvas: c })
  }
  if (stickerLayers.length) layers.push({ name: 'Stickers', opened: true, children: stickerLayers })

  return writePsdUint8Array({
    width: w,
    height: h,
    canvas: flat,
    children: [
      { name: terrain ? 'Sky' : 'Background', canvas: canvasOf(sky) },
      ...(terrain ? [{ name: 'Terrain', canvas: canvasOf(terrain) }] : []),
      ...layers,
      { name: 'Flattened thumbnail', canvas: flat, hidden: true }
    ]
  })
}

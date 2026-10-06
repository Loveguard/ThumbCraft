// Removes the background behind people in photos, on this computer (nothing is uploaded), using Google's
// MediaPipe selfie segmenter (Apache 2.0).
import { ImageSegmenter } from '@mediapipe/tasks-vision'
import { decodeImage } from './image'
import { registerMedia } from './media'
import { useStore, type ImageObject } from './store'

let segmenter: Promise<ImageSegmenter> | null = null

function getSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= ImageSegmenter.createFromOptions(
    {
      wasmLoaderPath: 'tcres://mediapipe/vision_wasm_internal.js',
      wasmBinaryPath: 'tcres://mediapipe/vision_wasm_internal.wasm'
    },
    {
      baseOptions: { modelAssetPath: 'tcres://mediapipe/selfie_segmenter.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false
    }
  ).catch((e) => {
    segmenter = null // let a later attempt retry
    throw e
  })
  return segmenter
}

/** Returns a PNG with everything but the person made transparent, cropped to them. */
export async function removeBackground(url: string): Promise<Blob> {
  const [img, seg] = await Promise.all([decodeImage(url), getSegmenter()])
  const w = img.naturalWidth
  const h = img.naturalHeight
  const result = seg.segment(img)
  const mask = result.confidenceMasks?.[0]
  if (!mask) {
    result.close()
    throw new Error('Background removal found nothing to cut out')
  }
  const conf = mask.getAsFloat32Array()
  const mw = mask.width
  const mh = mask.height
  result.close()

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const m = conf[Math.min(mh - 1, Math.floor((y * mh) / h)) * mw + Math.min(mw - 1, Math.floor((x * mw) / w))]
      // A soft but tight edge: unsure pixels fade instead of leaving a halo.
      const a = Math.min(1, Math.max(0, (m - 0.35) / 0.3))
      const i = (y * w + x) * 4 + 3
      px.data[i] = Math.round(px.data[i] * a)
      if (a > 0.5) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  if (maxX < 0) throw new Error("Couldn't find a person in this image")
  g.putImageData(px, 0, 0)

  // Crop to the person.
  const pad = 2
  const cx = Math.max(0, minX - pad)
  const cy = Math.max(0, minY - pad)
  const out = document.createElement('canvas')
  out.width = Math.min(w, maxX + pad + 1) - cx
  out.height = Math.min(h, maxY + pad + 1) - cy
  out.getContext('2d')!.drawImage(c, cx, cy, out.width, out.height, 0, 0, out.width, out.height)
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the cut-out'))), 'image/png')
  )
}

/** Replaces an image object's picture with its cut-out (the original stays in undo history). */
export async function cutOutImage(o: ImageObject): Promise<void> {
  const blob = await removeBackground(o.url)
  const media = registerMedia(
    `${o.name.replace(/\.[^.]+$/, '')}-cutout.png`,
    'image/png',
    new Uint8Array(await blob.arrayBuffer())
  )
  const img = await decodeImage(media.url)
  useStore.getState().update<ImageObject>(o.id, {
    url: media.url,
    mediaId: media.id,
    aspect: img.naturalWidth / img.naturalHeight || 1
  })
}

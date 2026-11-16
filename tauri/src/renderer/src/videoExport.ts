// The animation as a file: every frame rendered at the export size (effects included), then written as a video (MP4 or
// WebM, by the GPU's video encoder), a GIF, a PNG sequence, or a transparent WebM of just the characters.
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat
} from 'mediabunny'
import { zipSync } from 'fflate'
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { animationLength } from '@shared/animation'
import { animationOf, makeReframer, pause, posesAt, seek, useAnim } from './animation'
import { viewport } from './components/Viewport'
import { soundMix } from './sound'
import { drawStickers } from './stickers'
import { cameraBridge, newProjectInfo, useStore, type StickerObject } from './store'
import { addTab, type TabSnapshot } from './tabs'

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

export interface VideoProgress {
  frame: number
  frames: number
}

export type ExportKind = 'video' | 'gif' | 'png' | 'alpha'

export const EXPORT_KINDS: { id: ExportKind; label: string; hint: string }[] = [
  { id: 'video', label: 'Video (MP4)', hint: 'MP4 where this computer can encode it, otherwise WebM' },
  { id: 'gif', label: 'GIF', hint: 'A looping GIF, up to 640 px wide, 15 frames a second' },
  { id: 'png', label: 'PNG sequence', hint: 'Every frame as a numbered PNG, in one zip file' },
  {
    id: 'alpha',
    label: 'Characters on transparent',
    hint: 'A WebM of just the characters, with see-through background'
  }
]

export const EXPORT_SIZES: { id: string; label: string; size: [number, number] | null }[] = [
  { id: 'thumb', label: 'Same as the thumbnail', size: null },
  { id: '1080p', label: '1920 × 1080 · YouTube', size: [1920, 1080] },
  { id: '720p', label: '1280 × 720', size: [1280, 720] },
  { id: 'shorts', label: '1080 × 1920 · Shorts and Reels', size: [1080, 1920] },
  { id: 'square', label: '1080 × 1080 · Square', size: [1080, 1080] }
]

export interface ExportOptions {
  kind: ExportKind
  width: number
  height: number
  /** Frames averaged into each one for motion blur (1 is off). */
  blur: number
  /** A character to keep in the middle of the frame. */
  follow?: string | null
}

let cancelled = false
/** The character the export being made keeps in the middle of the frame. */
let follow: string | null = null
export const cancelVideo = (): void => void (cancelled = true)

/** Stops at the end of a frame when cancelled. Everything below renders through this. */
async function eachFrame(
  w: number,
  h: number,
  blur: number,
  onProgress: (p: VideoProgress) => void,
  take: (canvas: HTMLCanvasElement, i: number, fps: number) => Promise<void>,
  /** Renders the scene as it is into `g` (the default is the whole picture). */
  draw?: (g: CanvasRenderingContext2D, delta: number) => void
): Promise<{ fps: number; frames: number; cancelled: boolean }> {
  if (!viewport.frames) throw new Error('The viewport is not ready yet')
  const anim = animationOf()
  const fps = anim.fps
  const before = useAnim.getState().time
  if (useAnim.getState().playing) pause()
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  const sample = document.createElement('canvas')
  sample.width = w
  sample.height = h
  const sg = sample.getContext('2d')!
  const stickers = useStore.getState().objects.filter((o): o is StickerObject => o.kind === 'sticker' && o.visible)
  // A loop leaves out its last frame, which would repeat the first.
  const frames = Math.max(1, Math.round(animationLength(anim) * fps) + (anim.loop ? 0 : 1))
  const render = viewport.frames(w, h)
  const paint = draw ?? ((c, d) => render.draw(c, d))
  const reframer = follow ? makeReframer(follow, frames, fps, w / h) : null
  cancelled = false
  try {
    for (let i = 0; i < frames; i++) {
      if (cancelled) break
      g.clearRect(0, 0, w, h)
      if (blur <= 1) {
        posesAt(i / fps)
        reframer?.at(i)
        paint(g, 1 / fps)
      } else {
        // The shutter is open for half a frame: the picture is the average of a few moments within it.
        for (let s = 0; s < blur; s++) {
          posesAt((i + (s / blur) * 0.5) / fps)
          reframer?.at(i)
          sg.clearRect(0, 0, w, h)
          paint(sg, 1 / fps / blur)
          g.globalAlpha = 1 / (s + 1)
          g.drawImage(sample, 0, 0)
        }
        g.globalAlpha = 1
      }
      if (stickers.length) await drawStickers(g, stickers, w, h)
      await take(canvas, i, fps)
      onProgress({ frame: i + 1, frames })
      // Let the window breathe (and the progress show) every few frames.
      if (i % 4 === 3) await nextFrame()
    }
  } finally {
    render.end()
    reframer?.end()
    seek(before)
  }
  return { fps, frames, cancelled }
}

/** Encodes the animation at w×h with the given codec; null when cancelled. */
export async function renderVideo(
  w: number,
  h: number,
  codec: 'avc' | 'vp9' | 'vp8',
  onProgress: (p: VideoProgress) => void,
  blur = 1,
  alpha = false
): Promise<Uint8Array | null> {
  const output = new Output({
    format: codec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget()
  })
  return renderEncoded(output, w, h, codec, onProgress, blur, alpha)
}

async function renderEncoded(
  output: Output,
  w: number,
  h: number,
  codec: 'avc' | 'vp9' | 'vp8',
  onProgress: (p: VideoProgress) => void,
  blur: number,
  alpha: boolean
): Promise<Uint8Array | null> {
  let source: CanvasSource | null = null
  const fps = animationOf().fps
  const r = await eachFrame(
    w,
    h,
    blur,
    onProgress,
    async (canvas, i) => {
      if (!source) {
        source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, alpha: alpha ? 'keep' : 'discard' })
        output.addVideoTrack(source, { frameRate: fps })
        // The animation's sound goes along, as AAC in an MP4 or Opus in a WebM (whichever this computer can encode).
        const mix = await soundMix(animationLength(animationOf()) + 1 / fps)
        const audioCodec = mix && (await getFirstEncodableAudioCodec(output.format.getSupportedAudioCodecs()))
        const sound = mix && audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null
        if (sound) output.addAudioTrack(sound)
        await output.start()
        if (sound && mix) {
          await sound.add(mix)
          sound.close()
        }
      }
      await source.add(i / fps, 1 / fps)
    },
    alpha ? charactersOnly(w, h) : undefined
  )
  if (r.cancelled || !source) {
    await output.cancel()
    return null
  }
  await output.finalize()
  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('The video came out empty')
  return new Uint8Array(buffer)
}

/** Draws just the characters (and other objects that move), the rest of the scene cut away to see-through. */
function charactersOnly(w: number, h: number): (g: CanvasRenderingContext2D, delta: number) => void {
  const ids = useStore
    .getState()
    .objects.filter((o) => o.visible && (o.kind === 'player' || o.kind === 'mob'))
    .map((o) => o.id)
  return (g) => {
    if (!viewport.captureLayers) throw new Error('The viewport is not ready yet')
    const cap = viewport.captureLayers(w, h, ids)
    // What differs from the frame with the characters hidden is theirs.
    const out = g.createImageData(w, h)
    const a = cap.full.data
    const b = cap.background.data
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
      if (d < 6) continue
      out.data[i] = a[i]
      out.data[i + 1] = a[i + 1]
      out.data[i + 2] = a[i + 2]
      out.data[i + 3] = 255
    }
    g.putImageData(out, 0, 0)
  }
}

/** The animation as a looping GIF (at most 640 px wide, 15 frames a second), or null when cancelled. */
export async function renderGif(
  w: number,
  h: number,
  onProgress: (p: VideoProgress) => void,
  blur = 1
): Promise<Uint8Array | null> {
  const scale = Math.min(1, 640 / w)
  const gw = Math.max(2, Math.round(w * scale))
  const gh = Math.max(2, Math.round(h * scale))
  const gif = GIFEncoder()
  const small = document.createElement('canvas')
  small.width = gw
  small.height = gh
  const sg = small.getContext('2d', { willReadFrequently: true })!
  const fps = animationOf().fps
  // A GIF's frames last a hundredth of a second each, so only some frame rates come out true: keep every n-th frame.
  const step = Math.max(1, Math.round(fps / 15))
  const delay = Math.round((1000 * step) / fps)
  const r = await eachFrame(gw, gh, blur, onProgress, async (canvas, i) => {
    if (i % step) return
    sg.drawImage(canvas, 0, 0)
    const { data } = sg.getImageData(0, 0, gw, gh)
    const palette = quantize(data, 256)
    gif.writeFrame(applyPalette(data, palette), gw, gh, { palette, delay, repeat: 0 })
  })
  if (r.cancelled) return null
  gif.finish()
  return gif.bytes()
}

/** The animation as numbered PNGs in a zip file, or null when cancelled. */
export async function renderPngZip(
  w: number,
  h: number,
  onProgress: (p: VideoProgress) => void,
  blur = 1
): Promise<Uint8Array | null> {
  const files: Record<string, Uint8Array> = {}
  const r = await eachFrame(w, h, blur, onProgress, async (canvas, i) => {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('A frame could not be saved as PNG')
    files[`frame_${String(i + 1).padStart(4, '0')}.png`] = new Uint8Array(await blob.arrayBuffer())
  })
  if (r.cancelled) return null
  // PNGs are already compressed.
  return zipSync(files, { level: 0 })
}

/** Asks where to save, renders, and saves in the chosen kind of file. Null when cancelled. */
export async function exportAnimation(
  opts: ExportOptions,
  onProgress: (p: VideoProgress) => void,
  /** Where the file goes; by default the user is asked (Claude passes its own, see claudeBridge.ts). */
  target: {
    choose(name: string, ext: 'mp4' | 'webm' | 'gif' | 'zip'): Promise<string | null>
    write(bytes: Uint8Array): Promise<string>
  } = { choose: window.blockframe.chooseVideoFile, write: window.blockframe.writeVideo }
): Promise<string | null> {
  // Encoders want even sizes.
  const width = opts.width & ~1
  const height = opts.height & ~1
  const name = useStore.getState().project.name || 'animation'
  follow = opts.follow ?? null
  const save = async (
    ext: 'mp4' | 'webm' | 'gif' | 'zip',
    run: () => Promise<Uint8Array | null>
  ): Promise<string | null> => {
    const path = await target.choose(name, ext)
    if (!path) return null
    const bytes = await run()
    return bytes && target.write(bytes)
  }
  switch (opts.kind) {
    case 'gif':
      return save('gif', () => renderGif(width, height, onProgress, opts.blur))
    case 'png':
      return save('zip', () => renderPngZip(width, height, onProgress, opts.blur))
    case 'alpha': {
      const codec = await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width, height })
      if (!codec) throw new Error('This computer cannot encode video with a see-through background')
      return save('webm', () => renderVideo(width, height, codec as 'vp9' | 'vp8', onProgress, opts.blur, true))
    }
    default: {
      const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width, height })
      if (!codec || !['avc', 'vp9', 'vp8'].includes(codec)) throw new Error('This computer cannot encode video')
      return save(codec === 'avc' ? 'mp4' : 'webm', () =>
        renderVideo(width, height, codec as 'avc' | 'vp9' | 'vp8', onProgress, opts.blur)
      )
    }
  }
}

/**
 * Hands the frame at the playhead to the thumbnail editor: a new project tab with everything exactly where it is
 * now (characters, camera and lens), without the animation, ready to be a thumbnail at full quality.
 */
export function sendFrameToThumbnail(): void {
  const s = useStore.getState()
  const time = useAnim.getState().time
  const camera = cameraBridge.get?.() ?? null
  const fov = viewport.camera?.fov ?? s.settings.fov
  const snap: TabSnapshot = {
    objects: s.objects.map((o) => ({ ...o })),
    settings: { ...s.settings, animation: null, fov },
    effects: { ...s.effects },
    sky: { ...s.sky },
    project: { ...newProjectInfo(), name: `${s.project.name} at ${time.toFixed(1)} s`, dirty: true },
    past: [],
    future: [],
    camera
  }
  addTab(snap)
}

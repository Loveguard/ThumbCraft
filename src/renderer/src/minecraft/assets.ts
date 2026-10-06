// Renderer-side access to the loaded client jar: images, colormaps and texture atlases.
import * as THREE from 'three'
import { ModelResolver } from '@shared/minecraft/blockModel'
import type { RenderLayer, TextureSlot } from '@shared/minecraft/mesher'
import { VANILLA_MIP_LEVELS, vanillaMipmaps } from '@shared/minecraft/mipmap'
import type { Colormap, Colormaps } from '@shared/minecraft/tints'
import type { AssetBundle } from '@shared/types'

export const assetUrl = (path: string): string => `mcasset://textures/${path}.png`

const imageCache = new Map<string, Promise<HTMLImageElement | null>>()

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(url)
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
    imageCache.set(url, p)
  }
  return p
}

export function imageData(img: HTMLImageElement, w = img.width, h = img.height): ImageData {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export interface Atlas {
  texture: THREE.Texture
  slots: Map<string, TextureSlot>
}

export class AssetContext {
  readonly resolver: ModelResolver
  private colormapsPromise: Promise<Colormaps> | null = null

  constructor(readonly bundle: AssetBundle) {
    this.resolver = new ModelResolver(bundle.blockstates, bundle.models)
  }

  colormaps(): Promise<Colormaps> {
    if (!this.colormapsPromise) {
      const load = async (name: string): Promise<Colormap | null> => {
        const img = await loadImage(assetUrl(`colormap/${name}`))
        if (!img) return null
        const d = imageData(img)
        return { width: d.width, height: d.height, data: d.data }
      }
      this.colormapsPromise = Promise.all([load('grass'), load('foliage')]).then(([grass, foliage]) => ({
        grass,
        foliage
      }))
    }
    return this.colormapsPromise
  }

  private atlases = new Map<string, Promise<Atlas>>()

  /** The atlas for a set of textures; the same set is packed once and shared (terrain rebuilds, held blocks). */
  buildAtlas(names: Iterable<string>): Promise<Atlas> {
    const list = [...new Set(names)].sort()
    const key = list.join('\n')
    let p = this.atlases.get(key)
    if (!p) this.atlases.set(key, (p = this.packAtlas(list)))
    return p
  }

  /** Packs the given block textures (first animation frame of each) into one nearest-filtered atlas. */
  private async packAtlas(list: string[]): Promise<Atlas> {
    const images = await Promise.all(list.map((n) => loadImage(assetUrl(n))))
    const present = list
      .map((n, i) => ({ name: n, img: images[i] }))
      .filter((x): x is { name: string; img: HTMLImageElement } => !!x.img)
    const cell = Math.max(16, ...present.map((p) => p.img.width))
    // Each tile gets a gutter of repeated edge pixels so neither multisampling nor mipmaps can pull in
    // colours from the neighbouring tile (those showed up as seams and "repeating" texture edges).
    const pad = cell / 2
    const stride = cell + pad * 2
    const cols = Math.max(1, Math.ceil(Math.sqrt(present.length)))
    const rows = Math.max(1, Math.ceil(present.length / cols))
    const canvas = document.createElement('canvas')
    canvas.width = cols * stride
    canvas.height = rows * stride
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = false

    const slots = new Map<string, TextureSlot>()
    // Tiles with fully transparent pixels get the game's cutout-friendly mipmap blend.
    const holes = new Uint8Array(cols * rows)
    const W = canvas.width
    const H = canvas.height
    present.forEach(({ name, img }, i) => {
      const x = (i % cols) * stride + pad
      const y = Math.floor(i / cols) * stride + pad
      const frame = Math.min(img.width, img.height) // animated textures are vertical strips of square frames
      ctx.drawImage(img, 0, 0, img.width, frame, x, y, cell, cell)
      const px = ctx.getImageData(x, y, cell, cell).data
      let layer: RenderLayer = 'opaque'
      for (let k = 3; k < px.length; k += 4) {
        if (px[k] === 255) continue
        if (px[k] === 0) {
          holes[i] = 1
          if (layer === 'opaque') layer = 'cutout'
        } else layer = 'translucent'
      }
      // Extrude edges into the gutter: sides first, then corners.
      ctx.drawImage(canvas, x, y, cell, 1, x, y - pad, cell, pad)
      ctx.drawImage(canvas, x, y + cell - 1, cell, 1, x, y + cell, cell, pad)
      ctx.drawImage(canvas, x, y - pad, 1, cell + pad * 2, x - pad, y - pad, pad, cell + pad * 2)
      ctx.drawImage(canvas, x + cell - 1, y - pad, 1, cell + pad * 2, x + cell, y - pad, pad, cell + pad * 2)
      slots.set(name, {
        u0: x / W,
        u1: (x + cell) / W,
        v0: 1 - y / H,
        v1: 1 - (y + cell) / H,
        layer
      })
    })

    // Minecraft mipmaps block textures (Mipmap Levels, default 4); without it distant blocks shimmer.
    // The levels are built like the game does, so Fancy leaves stay see-through instead of filling in.
    const base = ctx.getImageData(0, 0, W, H)
    const levels = Math.min(VANILLA_MIP_LEVELS, Math.log2(cell) | 0)
    const mips = vanillaMipmaps(
      base,
      levels,
      (x, y) => holes[Math.floor(y / stride) * cols + Math.floor(x / stride)] === 1
    )
    const texture = new THREE.Texture(canvas)
    texture.mipmaps = [
      base,
      ...mips.map((m) => new ImageData(m.data as Uint8ClampedArray<ArrayBuffer>, m.width, m.height))
    ]
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestMipmapLinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    texture.anisotropy = 4
    texture.colorSpace = THREE.SRGBColorSpace
    // Cached and shared by every terrain and held block that uses this set: never disposed with one of them.
    texture.userData.shared = true
    return { texture, slots }
  }
}

let current: AssetContext | null = null
export function assetContext(bundle: AssetBundle | null): AssetContext | null {
  if (!bundle) return (current = null)
  if (current?.bundle !== bundle) current = new AssetContext(bundle)
  return current
}

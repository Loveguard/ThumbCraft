// Preview cards for biomes: a small pixel-art scene drawn from the biome's own sky, fog, grass and water
// colours and the game's block textures (surface block, what lies under it, typical trees).
import { biomeLook, type Tint } from '@shared/minecraft/biomeLook'
import { foliageColor, grassColor, type Colormaps } from '@shared/minecraft/tints'
import type { AssetBundle, Dimension } from '@shared/types'
import { hexColor as hex } from '../image'
import { assetUrl, loadImage } from './assets'

const W = 192
const H = 112
const T = 12 // pixels per block in the preview
const cache = new Map<string, Promise<string>>()

/** Deterministic noise per biome, so a card always looks the same. */
function rng(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296
}

/** A block texture drawn as one tile, optionally tinted (grayscale grass/leaves become green). */
async function tile(texture: string, tint: number | null): Promise<CanvasImageSource | null> {
  const img = await loadImage(assetUrl(texture))
  if (!img) return null
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16) // first frame of animated textures
  if (tint !== null) {
    g.globalCompositeOperation = 'multiply'
    g.fillStyle = hex(tint)
    g.fillRect(0, 0, 16, 16)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16)
  }
  return c
}

export function biomePreview(
  bundle: AssetBundle,
  maps: Colormaps | null,
  id: string,
  dimension: Dimension
): Promise<string> {
  const key = `${bundle.version}|${id}|${maps ? 1 : 0}`
  let p = cache.get(key)
  if (!p) {
    p = draw(bundle, maps, id, dimension)
    cache.set(key, p)
  }
  return p
}

async function draw(bundle: AssetBundle, maps: Colormaps | null, id: string, dimension: Dimension): Promise<string> {
  const biome = bundle.biomes[id]
  const look = biomeLook(id)
  const grass = maps ? grassColor(biome, maps) : 0x79c05a
  const foliage = maps ? foliageColor(biome, maps) : 0x59ae30
  const tintOf = (t: Tint): number | null => (t === 'grass' ? grass : t === 'foliage' ? foliage : t)
  const sky = biome?.effects.sky_color ?? 0x78a7ff
  const fog = biome?.effects.fog_color ?? 0xc0d8ff
  const water = biome?.effects.water_color ?? 0x3f76e4

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false

  // Sky: the biome's sky colour fading into its fog at the horizon (the Nether and End have only fog).
  const grad = g.createLinearGradient(0, 0, 0, H * 0.62)
  if (dimension === 'overworld') {
    grad.addColorStop(0, hex(sky))
    grad.addColorStop(1, hex(fog))
  } else {
    grad.addColorStop(0, dimension === 'the_end' ? '#0d0a14' : '#1a0606')
    grad.addColorStop(1, hex(fog))
  }
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)

  const rand = rng(id)
  const [top, under, overlay] = await Promise.all([
    tile(look.top, null),
    tile(look.filler, null),
    look.overlay ? tile(look.overlay.texture, tintOf(look.overlay.tint)) : Promise.resolve(null)
  ])

  // Distant hills in the fog.
  g.fillStyle = 'rgba(0,0,0,0.12)'
  for (let x = 0; x < W; x += 4) {
    const h = 18 + Math.sin(x / 23 + rand() * 0.4) * 7 + Math.sin(x / 9) * 2
    g.fillRect(x, H * 0.6 - h, 4, h)
  }

  // Ground: columns of blocks with a gently stepped surface.
  const cols = Math.ceil(W / T)
  const base = Math.round((H * 0.64) / T)
  const heights: number[] = []
  let h = 0
  for (let i = 0; i < cols; i++) {
    if (rand() < 0.3) h = Math.max(-1, Math.min(1, h + (rand() < 0.5 ? -1 : 1)))
    heights.push(look.water ? 0 : h)
  }
  const surfaceY = (i: number): number => (base - heights[i]) * T

  // Trees stand on the surface, drawn before the ground so trunks sit behind the grass edge.
  if (look.trees && !look.water) {
    const [log, leaves] = await Promise.all([
      tile(look.trees.log, null),
      tile(look.trees.leaves, tintOf(look.trees.tint))
    ])
    for (let n = 0; n < look.trees.count; n++) {
      const i = 1 + Math.floor(((n + 0.3 + rand() * 0.4) / look.trees.count) * (cols - 2))
      const trunk = look.trees.tall ? 4 : 3
      const y0 = surfaceY(i)
      for (let k = 1; k <= trunk; k++) if (log) g.drawImage(log, i * T, y0 - k * T, T, T)
      const crownY = y0 - (trunk + 1) * T
      for (let dy = 0; dy < (look.trees.tall ? 3 : 2); dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx !== 0 && look.trees.tall) continue
          if (leaves) g.drawImage(leaves, (i + dx) * T, crownY + dy * T - (look.trees.tall ? T : 0), T, T)
        }
    }
  }

  for (let i = 0; i < cols; i++) {
    const y0 = surfaceY(i)
    if (top) g.drawImage(top, i * T, y0, T, T)
    if (overlay) g.drawImage(overlay, i * T, y0, T, T)
    for (let y = y0 + T; y < H; y += T) if (under) g.drawImage(under, i * T, y, T, T)
    if (!top) {
      g.fillStyle = hex(grass)
      g.fillRect(i * T, y0, T, H - y0)
    }
  }

  // Oceans, rivers and beaches: a band of the biome's water over the sea bed.
  if (look.water) {
    const wy = base * T - 2
    g.fillStyle = hex(water)
    g.globalAlpha = 0.75
    g.fillRect(0, wy, id.includes('beach') || id.includes('shore') ? W * 0.55 : W, T * 1.6)
    g.globalAlpha = 1
  }

  // A soft vignette at the bottom keeps the label readable.
  const shade = g.createLinearGradient(0, H * 0.55, 0, H)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.55)')
  g.fillStyle = shade
  g.fillRect(0, 0, W, H)
  return c.toDataURL('image/png')
}

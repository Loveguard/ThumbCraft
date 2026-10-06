// three.js object builders for terrain, player models and text.
import * as THREE from 'three'
import {
  collectTextures,
  LAYERS,
  meshTerrain,
  type MeshBuffers,
  type RenderLayer,
  type TerrainMesh
} from '@shared/minecraft/mesher'
import {
  boxFaces,
  fullPose,
  normalizeSkin,
  playerParts,
  PLAYER_PIXEL,
  type PartName,
  type Pose
} from '@shared/minecraft/playerModel'
import type { TerrainData } from '@shared/types'
import type { LightDimension } from '@shared/minecraft/light'
import { assetUrl, imageData, loadImage, type AssetContext, type Atlas } from './assets'
import { applyBlockLight } from './lighting'
import { makeWaterReflective } from './waterReflection'
import type { TextObject } from '../store'
import { customFamily, fontWeight } from '../textStyles'
import { blockLetterCells, HARDCORE_HEART } from './blockLetters'

// ------------------------------------------------------------------ terrain

function geometryFrom(b: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2))
  g.setAttribute('color', new THREE.BufferAttribute(b.colors, 3))
  g.setAttribute('mcLight', new THREE.BufferAttribute(b.light, 2))
  g.setIndex(new THREE.BufferAttribute(b.indices, 1))
  g.computeBoundingSphere()
  return g
}

function terrainMaterial(layer: RenderLayer, map: THREE.Texture, lit: boolean, dim: LightDimension): THREE.Material {
  const params = {
    map,
    vertexColors: true,
    transparent: layer === 'translucent',
    alphaTest: layer === 'cutout' ? 0.5 : 0,
    depthWrite: layer !== 'translucent',
    side: layer === 'translucent' ? THREE.DoubleSide : THREE.FrontSide
  }
  // Standard (not Lambert) so an HDRI sky can light the terrain in Cinematic mode.
  const mat = lit
    ? new THREE.MeshStandardMaterial({ ...params, roughness: 1, metalness: 0 })
    : new THREE.MeshBasicMaterial(params)
  applyBlockLight(mat, dim, lit)
  return mat
}

/**
 * Frees what an object put on the GPU: geometries, materials and (unless shared) their textures, plus any
 * reflector render targets. Call when a built object is replaced or removed.
 */
export function disposeObject(root: THREE.Object3D, textures = true): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    for (const m of ([] as THREE.Material[]).concat(mesh.material ?? [])) {
      if (textures) for (const v of Object.values(m)) if (v instanceof THREE.Texture && !v.userData.shared) v.dispose()
      m.dispose()
    }
    const target = (o as { getRenderTarget?: () => THREE.WebGLRenderTarget }).getRenderTarget
    if (typeof target === 'function') target.call(o).dispose()
  })
}

// Meshing a big area takes a few hundred ms, and toggling reflections or switching render mode back and forth
// shouldn't redo it: meshes are kept per terrain (terrain data is never mutated, so it can key a WeakMap).
const meshes = new WeakMap<
  AssetContext,
  WeakMap<TerrainData, Map<string, Promise<{ mesh: TerrainMesh; atlas: Atlas }>>>
>()

function meshCached(
  ctx: AssetContext,
  terrain: TerrainData,
  ao: boolean,
  shade: boolean
): Promise<{ mesh: TerrainMesh; atlas: Atlas }> {
  let byTerrain = meshes.get(ctx)
  if (!byTerrain) meshes.set(ctx, (byTerrain = new WeakMap()))
  let byOpts = byTerrain.get(terrain)
  if (!byOpts) byTerrain.set(terrain, (byOpts = new Map()))
  const key = `${ao}|${shade}`
  let p = byOpts.get(key)
  if (!p) {
    p = (async () => {
      const [atlas, colormaps] = await Promise.all([
        ctx.buildAtlas(collectTextures(terrain.palette, ctx.resolver)),
        ctx.colormaps()
      ])
      const mesh = meshTerrain(terrain, ctx.resolver, (n) => atlas.slots.get(n) ?? null, ctx.bundle.biomes, colormaps, {
        ambientOcclusion: ao,
        biomeBlend: 2,
        directionalShade: shade
      })
      return { mesh, atlas }
    })()
    byOpts.set(key, p)
  }
  return p
}

/**
 * Builds the terrain group. Geometry is centred on X/Z with the lowest layer at y=0,
 * so a freshly generated biome sits on the origin.
 */
export async function buildTerrain(
  ctx: AssetContext,
  terrain: TerrainData,
  opts: { ambientOcclusion: boolean; cinematic: boolean; waterReflections?: boolean }
): Promise<THREE.Group> {
  const { mesh, atlas } = await meshCached(ctx, terrain, opts.ambientOcclusion, !opts.cinematic)
  const group = new THREE.Group()
  group.name = 'terrain'
  for (const layer of LAYERS) {
    if (!mesh[layer].indices.length) continue
    const m = new THREE.Mesh(
      geometryFrom(mesh[layer]),
      terrainMaterial(layer, atlas.texture, opts.cinematic, terrain.dimension)
    )
    m.position.set(-terrain.sizeX / 2, 0, -terrain.sizeZ / 2)
    m.castShadow = opts.cinematic
    m.receiveShadow = opts.cinematic
    if (layer === 'translucent') m.renderOrder = 1
    group.add(m)
  }
  if (mesh.waterSurface.indices.length) {
    const water = new THREE.Mesh(
      geometryFrom(mesh.waterSurface),
      terrainMaterial('translucent', atlas.texture, opts.cinematic, terrain.dimension)
    )
    water.position.set(-terrain.sizeX / 2, 0, -terrain.sizeZ / 2)
    water.receiveShadow = opts.cinematic
    water.renderOrder = 1
    if (opts.waterReflections) makeWaterReflective(water, terrain.sizeX, terrain.sizeZ)
    group.add(water)
  }
  return group
}

// ------------------------------------------------------------------ player

async function skinCanvas(url: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(url)
  if (!img) throw new Error('Could not load skin image')
  const data = imageData(img)
  const rgba = normalizeSkin(data.data, data.width, data.height)
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  c.getContext('2d')!.putImageData(new ImageData(rgba, 64, 64), 0, 0)
  return c
}

/** Geometry for model boxes in skin pixels; UVs are divided by the texture size (64×64 skins, 64×32 armor). */
export function boxGeometry(faces: ReturnType<typeof boxFaces>, texW = 64, texH = 64): THREE.BufferGeometry {
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const f of faces) {
    const base = pos.length / 3
    const [u0, v0, u1, v1] = f.uv
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1]
    ]
    f.corners.forEach((c, i) => {
      pos.push(c[0] * PLAYER_PIXEL, c[1] * PLAYER_PIXEL, c[2] * PLAYER_PIXEL)
      nrm.push(...f.normal)
      uv.push(uvs[i][0] / texW, 1 - uvs[i][1] / texH)
    })
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** A posable vanilla player model. Each limb is a child group named after its PartName. */
export async function buildPlayer(skinUrl: string, slim: boolean): Promise<THREE.Group> {
  const canvas = await skinCanvas(skinUrl)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  const base = new THREE.MeshLambertMaterial({ map: tex })
  const overlay = new THREE.MeshLambertMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide
  })

  const root = new THREE.Group()
  root.name = 'player'
  const groups = new Map<PartName, THREE.Group>()
  for (const part of playerParts(slim)) {
    const g = new THREE.Group()
    g.name = part.name
    g.userData.joint = part.name // lets a click on a limb find its joint
    g.position.set(part.pivot[0] * PLAYER_PIXEL, part.pivot[1] * PLAYER_PIXEL, part.pivot[2] * PLAYER_PIXEL)
    g.rotation.order = 'ZYX' // vanilla ModelPart applies Z·Y·X (X first)
    for (const b of part.boxes) {
      const m = new THREE.Mesh(boxGeometry(boxFaces(b)), b.overlay ? overlay : base)
      m.castShadow = true
      g.add(m)
    }
    ;(part.parent ? groups.get(part.parent)! : root).add(g)
    groups.set(part.name, g)
  }
  return root
}

/** The joint (part name) that a clicked mesh belongs to, if any. */
export function jointOf(o: THREE.Object3D | null): PartName | null {
  for (let x = o; x; x = x.parent) if (x.userData.joint) return x.userData.joint as PartName
  return null
}

export function applyPose(player: THREE.Object3D, pose: Partial<Pose>): void {
  for (const [name, rot] of Object.entries(fullPose(pose))) {
    const part = player.getObjectByName(name)
    if (part)
      part.rotation.set(
        THREE.MathUtils.degToRad(rot[0]),
        THREE.MathUtils.degToRad(rot[1]),
        THREE.MathUtils.degToRad(rot[2])
      )
  }
}

export const defaultSkinUrl = (slim: boolean): string =>
  assetUrl(slim ? 'entity/player/slim/alex' : 'entity/player/wide/steve')

// ------------------------------------------------------------------ text

/** Flat outlined title text on a transparent plane (the classic thumbnail look). */
export function textCanvas(
  o: Pick<
    TextObject,
    | 'text'
    | 'color'
    | 'outlineColor'
    | 'outlineWidth'
    | 'font'
    | 'fontMediaId'
    | 'shadow'
    | 'gradient'
    | 'outline2Color'
    | 'outline2Width'
    | 'glow'
  >
): HTMLCanvasElement {
  const size = 160
  const lines = o.text.split('\n')
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const family = o.fontMediaId ? `${customFamily(o.fontMediaId)}, ${o.font}` : o.font
  const font = `${fontWeight(o)} ${size}px ${family}`
  ctx.font = font
  const outer = o.outline2Width ?? 0
  const glow = o.glow ? 40 : 0
  const pad = o.outlineWidth + outer + glow + 24
  const width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
  c.width = Math.ceil(width + pad * 2)
  c.height = Math.ceil(lines.length * size * 1.1 + pad * 2)
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const x = c.width / 2
  const lineY = (i: number): number => pad + size * 1.1 * (i + 0.5)
  // Back to front: glow, drop shadow, outer outline, outline, fill.
  if (o.glow) {
    ctx.save()
    ctx.shadowColor = o.glow
    ctx.shadowBlur = glow
    ctx.fillStyle = o.glow
    ctx.strokeStyle = o.glow
    ctx.lineWidth = (o.outlineWidth + outer) * 2
    lines.forEach((line, i) => {
      ctx.strokeText(line, x, lineY(i))
      ctx.fillText(line, x, lineY(i))
    })
    ctx.restore()
  }
  lines.forEach((line, i) => {
    const y = lineY(i)
    if (o.shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      if (o.outlineWidth + outer > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'
        ctx.lineWidth = (o.outlineWidth + outer) * 2
        ctx.strokeText(line, x + size * 0.06, y + size * 0.08)
      }
      ctx.fillText(line, x + size * 0.06, y + size * 0.08)
    }
    if (outer > 0) {
      ctx.strokeStyle = o.outline2Color ?? '#000000'
      ctx.lineWidth = (o.outlineWidth + outer) * 2
      ctx.strokeText(line, x, y)
    }
    if (o.outlineWidth > 0) {
      ctx.strokeStyle = o.outlineColor
      ctx.lineWidth = o.outlineWidth * 2
      ctx.strokeText(line, x, y)
    }
    if (o.gradient) {
      const g = ctx.createLinearGradient(0, y - size * 0.4, 0, y + size * 0.4)
      g.addColorStop(0, o.color)
      g.addColorStop(1, o.gradient)
      ctx.fillStyle = g
    } else ctx.fillStyle = o.color
    ctx.fillText(line, x, y)
  })
  return c
}

interface Glyph {
  width: number
  pixels: boolean[] // 8×8
}

let fontPromise: Promise<Map<number, Glyph> | null> | null = null

/** Glyphs from Minecraft's own bitmap font (textures/font/ascii.png), widths measured like vanilla. */
export function minecraftFont(): Promise<Map<number, Glyph> | null> {
  if (!fontPromise) {
    fontPromise = loadImage(assetUrl('font/ascii')).then((img) => {
      if (!img) return null
      const d = imageData(img)
      const cell = d.width / 16
      const glyphs = new Map<number, Glyph>()
      for (let code = 32; code < 127; code++) {
        const gx = (code % 16) * cell
        const gy = Math.floor(code / 16) * cell
        const pixels: boolean[] = []
        let right = -1
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const sx = gx + Math.floor((x * cell) / 8)
            const sy = gy + Math.floor((y * cell) / 8)
            const on = d.data[(sy * d.width + sx) * 4 + 3] > 127
            pixels.push(on)
            if (on) right = Math.max(right, x)
          }
        glyphs.set(code, { width: code === 32 ? 4 : right + 1, pixels })
      }
      return glyphs
    })
  }
  return fontPromise
}

/** Which font pixels are filled for `text` (one cell per font pixel, rows 10 pixels apart). */
function layoutText(glyphs: Map<number, Glyph>, text: string): { filled: Set<string>; width: number; height: number } {
  const lines = text.split('\n')
  const filled = new Set<string>()
  let width = 0
  lines.forEach((line, row) => {
    let cursor = 0
    for (const ch of line) {
      const g = glyphs.get(ch.charCodeAt(0)) ?? glyphs.get(63)!
      g.pixels.forEach((on, i) => on && filled.add(`${cursor + (i % 8)},${row * 10 + Math.floor(i / 8)}`))
      cursor += g.width + 1
    }
    width = Math.max(width, cursor - 1)
  })
  return { filled, width, height: lines.length * 10 - 2 }
}

/** Per-vertex colour for a quad: one value, or [front, back] for faces running along the depth. */
type Shade = number | [number, number]

/**
 * Culled voxel geometry for a set of filled cells, centred on the origin, `depth` cells deep, scaled by `scale`.
 * `shade` gives each face's vertex brightness (for the stone looks); UVs map one texture pixel per cell.
 */
function voxelGeometry(
  filled: Set<string>,
  width: number,
  height: number,
  depth: number,
  scale: number,
  shade?: (px: number, py: number, normal: number[]) => Shade,
  tint?: (px: number, py: number) => [number, number, number]
): THREE.BufferGeometry {
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const z0 = -depth / 2
  const z1 = depth / 2
  for (const key of filled) {
    const [px, py] = key.split(',').map(Number)
    const x0 = px - width / 2
    const x1 = x0 + 1
    const y1 = height / 2 - py
    const y0 = y1 - 1
    const has = (dx: number, dy: number): boolean => filled.has(`${px + dx},${py + dy}`)
    const rgb = tint?.(px, py) ?? [1, 1, 1]
    const quad = (v: number[][], n: number[], t: number[][]): void => {
      const s = shade?.(px, py, n) ?? 1
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...v[i])
        nrm.push(...n)
        uv.push(t[i][0] / 16, t[i][1] / 16)
        const c = Array.isArray(s) ? (v[i][2] === z1 ? s[0] : s[1]) : s
        col.push(c * rgb[0], c * rgb[1], c * rgb[2])
      }
    }
    const front = (x: number, y: number): number[] => [x, y]
    quad(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1]
      ],
      [0, 0, 1],
      [front(x0, y0), front(x1, y0), front(x1, y1), front(x0, y1)]
    )
    quad(
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0]
      ],
      [0, 0, -1],
      [
        [x1, y0],
        [x0, y0],
        [x0, y1],
        [x1, y1]
      ]
    )
    // Sides run one texture pixel per cell of depth too, so the extrusion reads as stacked blocks.
    if (!has(-1, 0))
      quad(
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0]
        ],
        [-1, 0, 0],
        [
          [z0, y0],
          [z1, y0],
          [z1, y1],
          [z0, y1]
        ]
      )
    if (!has(1, 0))
      quad(
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1]
        ],
        [1, 0, 0],
        [
          [z1, y0],
          [z0, y0],
          [z0, y1],
          [z1, y1]
        ]
      )
    if (!has(0, -1))
      quad(
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0]
        ],
        [0, 1, 0],
        [
          [x0, z1],
          [x1, z1],
          [x1, z0],
          [x0, z0]
        ]
      )
    if (!has(0, 1))
      quad(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1]
        ],
        [0, -1, 0],
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1]
        ]
      )
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.scale(scale, scale, scale)
  return g
}

export type PixelTextStyle = 'plain' | 'stone' | 'hardcore'

/** Extruded voxel text built from the Minecraft font. One unit = one font pixel × 1/8 block. */
export async function buildPixelText(
  text: string,
  color: string,
  depth: number,
  shadow: boolean,
  style: PixelTextStyle = 'plain'
): Promise<THREE.Group> {
  const group = new THREE.Group()
  if (style === 'hardcore') return buildHardcoreText(text, color, depth, shadow, group)
  if (style === 'stone') return buildStoneText(text, color, depth, shadow, group)
  const glyphs = await minecraftFont()
  if (!glyphs) return group
  const { filled, width, height } = layoutText(glyphs, text)
  const main = new THREE.Mesh(
    voxelGeometry(filled, width, height, depth, 1 / 8),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(color) })
  )
  main.castShadow = true
  group.add(main)
  if (shadow) {
    // Vanilla draws text shadows at 1px offset with the colour darkened to 25%.
    const c = new THREE.Color(color).multiplyScalar(0.25)
    const back = new THREE.Mesh(
      voxelGeometry(filled, width, height, depth, 1 / 8),
      new THREE.MeshLambertMaterial({ color: c })
    )
    back.position.set(1 / 8, -1 / 8, (-depth * 0.5) / 8)
    group.add(back)
  }
  return group
}

let stoneTexture: Promise<THREE.Texture | null> | null = null
/**
 * The game's stone texture, made into a light, low-contrast surface: carved title letters read as pale stone
 * with the stone's pixel grain, and take any tint (grey, hardcore red) cleanly.
 */
function stoneMap(): Promise<THREE.Texture | null> {
  stoneTexture ??= loadImage(assetUrl('block/stone')).then((img) => {
    if (!img) return null
    const d = imageData(img)
    const lum = (i: number): number => 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]
    let mean = 0
    for (let i = 0; i < d.data.length; i += 4) mean += lum(i)
    mean /= d.data.length / 4
    const c = document.createElement('canvas')
    c.width = d.width
    c.height = d.height
    const out = new ImageData(d.width, d.height)
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.round(255 * Math.min(1, Math.max(0, 0.82 + ((lum(i) - mean) / 255) * 0.7)))
      out.data.set([v, v, v, 255], i)
    }
    c.getContext('2d')!.putImageData(out, 0, 0)
    const t = new THREE.CanvasTexture(c)
    t.userData.shared = true
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })
  return stoneTexture
}

/** Deterministic 0…1 noise per cell. */
function cellNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Chunky carved title letters in the style of game logos: a block alphabet thickened into blocks, a stone
 * face (the game's own stone texture) with chiselled dark edges and cracks, a deep extrusion fading to black,
 * and a black outline behind. The colour tints the stone (grey, gold, diamond…).
 */
async function buildStoneText(
  text: string,
  color: string,
  depth: number,
  outline: boolean,
  group: THREE.Group
): Promise<THREE.Group> {
  const base = blockLetterCells(text)
  // Each letter pixel becomes 2×2 cells, then strokes grow one cell right and down: 3-cell-thick strokes
  // with 1-cell slits, the heavy blocky letterforms of a logo.
  const filled = new Set<string>()
  for (const key of base.filled) {
    const [x, y] = key.split(',').map(Number)
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) filled.add(`${x * 2 + dx},${y * 2 + dy}`)
  }
  const width = base.width * 2 + 1
  const height = base.height * 2 + 1
  const cells = depth * 2
  const empty = (x: number, y: number): boolean => !filled.has(`${x},${y}`)
  const scale = 1 / 16

  const shade = (px: number, py: number, n: number[]): Shade => {
    if (n[2] === 1) {
      // Face: darker toward the bottom of each line, a carved bevel (lit top-left edges, shaded
      // bottom-right ones), and the odd crack.
      const row = py % 14
      let s = 1.05 - (row / 11) * 0.25
      if (empty(px, py + 1) || empty(px + 1, py)) s *= 0.7
      else if (empty(px, py - 1) || empty(px - 1, py)) s *= 1.12
      else if (cellNoise(px, py, 3) < 0.09) s *= 0.55
      return s
    }
    if (n[2] === -1) return 0.12
    // Extrusion: lit from above, fading to near-black toward the back.
    const side = n[1] === 1 ? 0.62 : n[1] === -1 ? 0.22 : 0.4
    return [side, side * 0.25]
  }

  const tint = new THREE.Color(color)
  const map = await stoneMap()
  const material = new THREE.MeshLambertMaterial({
    color: tint,
    map,
    vertexColors: true
  })
  const main = new THREE.Mesh(voxelGeometry(filled, width, height, cells, scale, shade), material)
  main.castShadow = true
  group.add(main)

  if (outline) {
    // A black rim around the letters' silhouette, as thick as a stroke gap, behind the extrusion.
    const rim = new Set<string>()
    for (const key of filled) {
      const [x, y] = key.split(',').map(Number)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) rim.add(`${x + dx + 1},${y + dy + 1}`)
    }
    const back = new THREE.Mesh(
      voxelGeometry(rim, width + 2, height + 2, cells, scale),
      new THREE.MeshBasicMaterial({ color: 0x0d0d0d })
    )
    back.position.z = -0.01
    back.scale.z = 0.98
    group.add(back)
  }
  return group
}

/**
 * Hardcore-video title letters: a front-on look rather than a carved block. Open, rounded letters (each letter
 * pixel a 3×3 block, outer corners clipped), a glossy pixelated red face, a dark-red layer dropping below it
 * for depth, and a thick black outline. Every O becomes the hardcore heart.
 */
function buildHardcoreText(
  text: string,
  color: string,
  depth: number,
  outline: boolean,
  group: THREE.Group
): THREE.Group {
  const base = blockLetterCells(text, true)
  const S = 3
  const raw = new Set<string>()
  for (const key of base.filled) {
    const [x, y] = key.split(',').map(Number)
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) raw.add(`${x * S + dx},${y * S + dy}`)
  }
  const has = (set: Set<string>, x: number, y: number): boolean => set.has(`${x},${y}`)
  // Clip every outer corner cell: the letters read round and chunky rather than square.
  const face = new Set<string>()
  for (const key of raw) {
    const [x, y] = key.split(',').map(Number)
    // Only true outer corners: open on two adjacent sides and on the diagonal between them.
    const open = (dx: number, dy: number): boolean =>
      !has(raw, x + dx, y) && !has(raw, x, y + dy) && !has(raw, x + dx, y + dy)
    if (!(open(-1, -1) || open(1, -1) || open(-1, 1) || open(1, 1))) face.add(key)
  }

  // Hearts: the sprite at 2 cells per pixel, centred on the letters' line.
  const heartColours: Record<string, [number, number, number]> = {
    K: [0.08, 0.01, 0.01],
    R: [0.9, 0.08, 0.06],
    D: [0.5, 0.02, 0.02],
    H: [1, 0.72, 0.7]
  }
  const heartCells = new Map<string, [number, number, number]>()
  for (const [hx, hy] of base.hearts) {
    const ox = hx * S - 1
    const oy = hy * S - 2
    HARDCORE_HEART.forEach((row, y) =>
      [...row].forEach((p, x) => {
        if (p === '.') return
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) heartCells.set(`${ox + x * 2 + dx},${oy + y * 2 + dy}`, heartColours[p])
      })
    )
  }
  const solid = new Set([...face, ...heartCells.keys()])

  const width = base.width * S
  const height = base.height * S
  const cells = Math.max(1, depth)
  const scale = 1 / 24
  const drop = 3 // how far the dark-red layer hangs below the face, in cells

  // Face: a pixel-noise red with a bright top lip and a darker lower edge on every stroke.
  const faceShade = (px: number, py: number, n: number[]): Shade => {
    if (n[2] !== 1) return n[1] === 1 ? 0.9 : 0.55
    let s = 1
    if (!has(face, px, py - 1)) s = 1.3
    else if (!has(face, px, py - 2)) s = 1.12
    else if (!has(face, px, py + 1)) s = 0.62
    else {
      const blotch = cellNoise(Math.floor(px / 2), Math.floor(py / 2), 11)
      s = blotch < 0.22 ? 0.72 : blotch > 0.9 ? 1.15 : 1
    }
    return s
  }
  const main = new THREE.Mesh(
    voxelGeometry(face, width, height, cells, scale, faceShade),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(color), vertexColors: true })
  )
  main.castShadow = true
  group.add(main)

  if (heartCells.size) {
    const heart = new THREE.Mesh(
      voxelGeometry(new Set(heartCells.keys()), width, height, cells, scale, undefined, (x, y) =>
        heartCells.get(`${x},${y}`)!
      ),
      new THREE.MeshLambertMaterial({ vertexColors: true })
    )
    heart.position.z = 0.002
    group.add(heart)
  }

  // The dark-red layer under the letters gives the front-on 3D: the same shapes, lower and further back.
  const under = new THREE.Mesh(
    voxelGeometry(solid, width, height, cells, scale),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.32) })
  )
  under.position.set(0, -drop * scale, (-cells * scale) / 2)
  group.add(under)

  if (outline) {
    // A thick black border around letters and drop together.
    const both = new Set(solid)
    for (const key of solid) {
      const [x, y] = key.split(',').map(Number)
      for (let d = 1; d <= drop; d++) both.add(`${x},${y + d}`)
    }
    const rim = new Set<string>()
    const R = 2
    for (const key of both) {
      const [x, y] = key.split(',').map(Number)
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) if (Math.abs(dx) + Math.abs(dy) <= R + 1) rim.add(`${x + dx},${y + dy}`)
    }
    const back = new THREE.Mesh(
      voxelGeometry(rim, width, height, cells, scale),
      new THREE.MeshBasicMaterial({ color: 0x0a0000 })
    )
    back.position.z = -cells * scale * 0.75
    group.add(back)
  }
  return group
}

// ------------------------------------------------------------------ name tags

/** Vanilla draws a name tag 0.5 blocks above the player's 1.8-block hitbox, 0.025 blocks per font pixel. */
export const NAME_TAG_HEIGHT = 2.3
const TAG_PIXEL = 0.025

/**
 * A player name tag as the game draws it: the Minecraft font in white on a black plate at 25% opacity
 * (vanilla's text background), one pixel of padding, always facing the camera.
 */
export async function buildNameTag(name: string): Promise<THREE.Sprite> {
  const glyphs = await minecraftFont()
  const text = name || ' '
  // Width in font pixels: each glyph plus one pixel of spacing (vanilla's advance).
  const advance = (ch: string): number => (glyphs?.get(ch.charCodeAt(0))?.width ?? 5) + 1
  const textW = glyphs ? [...text].reduce((w, ch) => w + advance(ch), 0) - 1 : text.length * 6
  const W = textW + 2
  const H = 10
  const S = 8 // canvas pixels per font pixel; drawn crisp and scaled with nearest filtering
  const c = document.createElement('canvas')
  c.width = W * S
  c.height = H * S
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffffff'
  if (glyphs) {
    let x = 1
    for (const ch of text) {
      const gl = glyphs.get(ch.charCodeAt(0))
      if (gl)
        for (let py = 0; py < 8; py++)
          for (let px = 0; px < 8; px++) if (gl.pixels[py * 8 + px]) g.fillRect((x + px) * S, (1 + py) * S, S, S)
      x += advance(ch)
    }
  } else {
    g.font = `${8 * S}px monospace`
    g.textBaseline = 'top'
    g.fillText(text, S, S)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false }))
  sprite.scale.set(W * TAG_PIXEL, H * TAG_PIXEL, 1)
  sprite.position.y = NAME_TAG_HEIGHT
  sprite.renderOrder = 900
  sprite.raycast = () => undefined // clicking the tag shouldn't grab it instead of the player
  return sprite
}

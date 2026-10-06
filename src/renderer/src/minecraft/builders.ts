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
      if (textures) for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
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

/** Extruded voxel text built from the Minecraft font. One unit = one font pixel × 1/8 block. */
export async function buildPixelText(
  text: string,
  color: string,
  depth: number,
  shadow: boolean
): Promise<THREE.Group> {
  const glyphs = await minecraftFont()
  const group = new THREE.Group()
  if (!glyphs) return group
  const lines = text.split('\n')
  const filled = new Set<string>()
  let maxW = 0
  lines.forEach((line, row) => {
    let cursor = 0
    for (const ch of line) {
      const g = glyphs.get(ch.charCodeAt(0)) ?? glyphs.get(63)!
      g.pixels.forEach((on, i) => on && filled.add(`${cursor + (i % 8)},${row * 10 + Math.floor(i / 8)}`))
      cursor += g.width + 1
    }
    maxW = Math.max(maxW, cursor - 1)
  })
  const height = lines.length * 10 - 2

  const build = (dz: number, offset: number): THREE.BufferGeometry => {
    const pos: number[] = []
    const nrm: number[] = []
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]): void => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d)
      for (let i = 0; i < 6; i++) nrm.push(...n)
    }
    for (const key of filled) {
      const [px, py] = key.split(',').map(Number)
      const x0 = px - maxW / 2 + offset
      const x1 = x0 + 1
      const y1 = height / 2 - py - offset
      const y0 = y1 - 1
      const z0 = -depth / 2 + dz
      const z1 = depth / 2 + dz
      const has = (dx: number, dy: number): boolean => filled.has(`${px + dx},${py + dy}`)
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1])
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1])
      if (!has(-1, 0)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0])
      if (!has(1, 0)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0])
      if (!has(0, -1)) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0])
      if (!has(0, 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.scale(1 / 8, 1 / 8, 1 / 8)
    return g
  }

  const main = new THREE.Mesh(build(0, 0), new THREE.MeshLambertMaterial({ color: new THREE.Color(color) }))
  main.castShadow = true
  group.add(main)
  if (shadow) {
    // Vanilla draws text shadows at 1px offset with the colour darkened to 25%.
    const c = new THREE.Color(color).multiplyScalar(0.25)
    group.add(new THREE.Mesh(build(-depth * 0.5, 1), new THREE.MeshLambertMaterial({ color: c })))
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

// Turns a TerrainData box into merged, face-culled geometry buffers (one per render layer).
import type { BiomeInfo, BlockState, TerrainData } from '../types'
import { DIR_VEC, DIRS, ModelResolver, stripNs, type BakedModel, type Dir, type Quad } from './blockModel'
import { computeLight, lightEmission } from './light'
import { blendColors, blockTint, faceShade, foliageColor, grassColor, waterColor, type Colormaps } from './tints'

export type RenderLayer = 'opaque' | 'cutout' | 'translucent'
export const LAYERS: RenderLayer[] = ['opaque', 'cutout', 'translucent']

export interface TextureSlot {
  /** Atlas UVs in three.js convention (v=1 is the top of the image). v0 is the texture's top edge. */
  u0: number
  v0: number
  u1: number
  v1: number
  layer: RenderLayer
}

export interface MeshBuffers {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** Linear-space vertex colours (tint × directional shade × ambient occlusion). */
  colors: Float32Array
  /** Vanilla light per vertex: (sky, block) levels as 0–1 (level / 15), smoothed like the game. */
  light: Float32Array
  indices: Uint32Array
}

/** Geometry per render layer, plus the upward water faces on their own (so they can reflect). */
export type TerrainMesh = Record<RenderLayer, MeshBuffers> & { waterSurface: MeshBuffers }

export interface MeshOptions {
  ambientOcclusion: boolean
  /** Vanilla "Biome Blend" radius; default 2 (5×5). */
  biomeBlend: number
  /** Bake vanilla's per-direction face brightness into vertex colours (off when using real lights). */
  directionalShade?: boolean
}

const ALWAYS_WATERLOGGED = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column'])

/** Every texture the given palette can reference — load these into the atlas before meshing. */
export function collectTextures(palette: BlockState[], resolver: ModelResolver): Set<string> {
  const out = new Set<string>(['block/water_still', 'block/lava_still'])
  for (const state of palette) {
    // Sample several positions so every weighted variant (e.g. randomly rotated models) is covered.
    for (let i = 0; i < 8; i++)
      for (const v of resolver.variantsFor(state, [i * 7, i, i * 13]))
        for (const q of resolver.bake(v).quads) out.add(q.texture)
  }
  return out
}

class Builder {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
  colors: number[] = []
  light: number[] = []
  indices: number[] = []
  finish(): MeshBuffers {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      light: new Float32Array(this.light),
      indices: new Uint32Array(this.indices)
    }
  }
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

interface PaletteInfo {
  state: BlockState
  short: string
  occludes: boolean
  fluid: 'water' | 'lava' | null
  fluidHeight: number
  positional: boolean
  baked: BakedModel[]
  selfCulls: boolean
}

export function meshTerrain(
  t: TerrainData,
  resolver: ModelResolver,
  textures: (name: string) => TextureSlot | null,
  biomes: Record<string, BiomeInfo>,
  colormaps: Colormaps,
  opts: MeshOptions = { ambientOcclusion: true, biomeBlend: 2 }
): TerrainMesh {
  const { sizeX: sx, sizeY: sy, sizeZ: sz } = t
  const nether = t.dimension === 'the_nether'

  const info: PaletteInfo[] = t.palette.map((state) => {
    const short = stripNs(state.name)
    const variants = resolver.variantsFor(state)
    const baked = variants.map((v) => resolver.bake(v))
    const occludes = baked.some(
      (m) => m.fullCube && m.quads.filter((q) => q.onBoundary).every((q) => textures(q.texture)?.layer === 'opaque')
    )
    const fluid =
      short === 'water' || state.properties.waterlogged === 'true' || ALWAYS_WATERLOGGED.has(short)
        ? 'water'
        : short === 'lava'
          ? 'lava'
          : null
    const level = Number(state.properties.level ?? 0)
    const fluidHeight = short === 'water' || short === 'lava' ? (level >= 8 ? 1 : (8 - level) / 9) : 8 / 9
    const positional = resolver.isPositional(state)
    const selfCulls = !occludes && baked.some((m) => m.fullCube) && !short.endsWith('_leaves')
    return { state, short, occludes, fluid, fluidHeight, positional, baked, selfCulls }
  })

  const idx = (x: number, y: number, z: number): number => x + z * sx + y * sx * sz
  const at = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : t.blocks[idx(x, y, z)]
  const occ = (x: number, y: number, z: number): boolean => info[at(x, y, z)].occludes

  // Sky and block light, flood-filled like the game. Leaves, water and other see-through full blocks dim it
  // by one extra level; glass lets it through.
  const hasSky = t.dimension === 'overworld'
  const opacity = info.map((inf) =>
    inf.occludes ? 15 : inf.fluid || (inf.baked.some((m) => m.fullCube) && !inf.short.includes('glass')) ? 1 : 0
  )
  const emission = info.map((inf) => lightEmission(inf.state.name, inf.state.properties))
  const light = computeLight(
    sx,
    sy,
    sz,
    t.blocks,
    (i) => opacity[i] ?? 0,
    (i) => emission[i] ?? 0,
    hasSky
  )
  /** (sky, block) light levels at a cell. Outside the box counts as open, sky-lit air (except below it). */
  const lightAt = (x: number, y: number, z: number): [number, number] => {
    if (y < 0) return [0, 0]
    if (y >= sy || x < 0 || z < 0 || x >= sx || z >= sz) return [hasSky ? 15 : 0, 0]
    const i = idx(x, y, z)
    return [light.sky[i], light.block[i]]
  }

  // Per-column biome colours, blended like the vanilla client.
  const raw = (fn: (b: BiomeInfo | undefined) => number): Int32Array => {
    const out = new Int32Array(sx * sz)
    for (let i = 0; i < out.length; i++) out[i] = fn(biomes[stripNs(t.biomePalette[t.biomes[i]] ?? '')])
    return out
  }
  const blendField = (field: Int32Array): Int32Array => {
    const out = new Int32Array(field.length)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++)
        out[x + z * sx] = blendColors((dx, dz) => {
          const xx = x + dx
          const zz = z + dz
          return xx < 0 || zz < 0 || xx >= sx || zz >= sz ? -1 : field[xx + zz * sx]
        }, opts.biomeBlend)
    return out
  }
  const grass = blendField(raw((b) => grassColor(b, colormaps)))
  const foliage = blendField(raw((b) => foliageColor(b, colormaps)))
  const water = blendField(raw((b) => waterColor(b)))

  const out: Record<RenderLayer | 'waterSurface', Builder> = {
    opaque: new Builder(),
    cutout: new Builder(),
    translucent: new Builder(),
    waterSurface: new Builder()
  }

  const emit = (
    q: Quad,
    ox: number,
    oy: number,
    oz: number,
    tint: number,
    aoValues: number[] | null,
    lightValues: [number, number][],
    slot: TextureSlot,
    layerOverride?: RenderLayer | 'waterSurface'
  ): void => {
    const b = out[layerOverride ?? slot.layer]
    const base = b.positions.length / 3
    const p = q.positions
    // Face normal from geometry (handles rotated elements).
    const ax = p[1][0] - p[0][0]
    const ay = p[1][1] - p[0][1]
    const az = p[1][2] - p[0][2]
    const bx = p[3][0] - p[0][0]
    const by = p[3][1] - p[0][1]
    const bz = p[3][2] - p[0][2]
    let nx = by * az - bz * ay
    let ny = bz * ax - bx * az
    let nz = bx * ay - by * ax
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const shade = opts.directionalShade === false ? 1 : faceShade(q.dir, q.shade, nether)
    const tr = ((tint >> 16) & 255) / 255
    const tg = ((tint >> 8) & 255) / 255
    const tb = (tint & 255) / 255
    for (let i = 0; i < 4; i++) {
      b.positions.push(p[i][0] + ox, p[i][1] + oy, p[i][2] + oz)
      b.normals.push(nx, ny, nz)
      const [u, v] = q.uvs[i]
      b.uvs.push(slot.u0 + (u / 16) * (slot.u1 - slot.u0), slot.v0 + (v / 16) * (slot.v1 - slot.v0))
      const k = shade * (aoValues ? aoValues[i] : 1)
      b.colors.push(srgbToLinear(tr * k), srgbToLinear(tg * k), srgbToLinear(tb * k))
      b.light.push(lightValues[i][0] / 15, lightValues[i][1] / 15)
    }
    // Split the quad along the diagonal that keeps AO gradients smooth (vanilla does the same).
    if (aoValues && aoValues[0] + aoValues[2] < aoValues[1] + aoValues[3]) {
      b.indices.push(base + 1, base, base + 3, base + 1, base + 3, base + 2)
    } else {
      b.indices.push(base, base + 3, base + 2, base, base + 2, base + 1)
    }
  }

  const aoFor = (q: Quad, x: number, y: number, z: number): number[] => {
    const n = DIR_VEC[q.dir]
    const cx = x + n[0]
    const cy = y + n[1]
    const cz = z + n[2]
    const axis = n[0] ? 0 : n[1] ? 1 : 2
    const tA = axis === 0 ? 1 : 0
    const tB = axis === 2 ? 1 : 2
    const lum = (ox: number, oy: number, oz: number): number => (occ(cx + ox, cy + oy, cz + oz) ? 0.2 : 1)
    const centre = lum(0, 0, 0)
    return q.positions.map((p) => {
      const o1 = [0, 0, 0]
      const o2 = [0, 0, 0]
      o1[tA] = p[tA] < 0.5 ? -1 : 1
      o2[tB] = p[tB] < 0.5 ? -1 : 1
      const s1 = lum(o1[0], o1[1], o1[2])
      const s2 = lum(o2[0], o2[1], o2[2])
      const c = s1 < 1 && s2 < 1 ? 0.2 : lum(o1[0] + o2[0], o1[1] + o2[1], o1[2] + o2[2])
      return (s1 + s2 + c + centre) / 4
    })
  }

  /**
   * Smooth lighting: a face on the block boundary averages the light of the four cells around each corner on
   * its outer side (dark/solid samples take the centre's value, as in vanilla). Other faces use their own cell.
   */
  const lightFor = (q: Quad, x: number, y: number, z: number): [number, number][] => {
    if (!q.onBoundary) {
      const own = lightAt(x, y, z)
      return [own, own, own, own]
    }
    const n = DIR_VEC[q.dir]
    const cx = x + n[0]
    const cy = y + n[1]
    const cz = z + n[2]
    const axis = n[0] ? 0 : n[1] ? 1 : 2
    const tA = axis === 0 ? 1 : 0
    const tB = axis === 2 ? 1 : 2
    const centre = lightAt(cx, cy, cz)
    return q.positions.map((p) => {
      const o1 = [0, 0, 0]
      const o2 = [0, 0, 0]
      o1[tA] = p[tA] < 0.5 ? -1 : 1
      o2[tB] = p[tB] < 0.5 ? -1 : 1
      const s1 = lightAt(cx + o1[0], cy + o1[1], cz + o1[2])
      const s2 = lightAt(cx + o2[0], cy + o2[1], cz + o2[2])
      const both = occ(cx + o1[0], cy + o1[1], cz + o1[2]) && occ(cx + o2[0], cy + o2[1], cz + o2[2])
      const c = both ? s1 : lightAt(cx + o1[0] + o2[0], cy + o1[1] + o2[1], cz + o1[2] + o2[2])
      const avg = (k: 0 | 1): number => {
        const vals = [s1[k], s2[k], c[k]].map((v) => (v === 0 ? centre[k] : v))
        return (vals[0] + vals[1] + vals[2] + centre[k]) / 4
      }
      return [avg(0), avg(1)] as [number, number]
    })
  }

  const fluidQuads = (h: number, faces: Dir[]): Quad[] =>
    faces.map((d) => {
      const corners = (
        {
          up: [
            [0, h, 0],
            [1, h, 0],
            [1, h, 1],
            [0, h, 1]
          ],
          down: [
            [0, 0, 1],
            [1, 0, 1],
            [1, 0, 0],
            [0, 0, 0]
          ],
          north: [
            [1, h, 0],
            [0, h, 0],
            [0, 0, 0],
            [1, 0, 0]
          ],
          south: [
            [0, h, 1],
            [1, h, 1],
            [1, 0, 1],
            [0, 0, 1]
          ],
          west: [
            [0, h, 0],
            [0, h, 1],
            [0, 0, 1],
            [0, 0, 0]
          ],
          east: [
            [1, h, 1],
            [1, h, 0],
            [1, 0, 0],
            [1, 0, 1]
          ]
        } as Record<Dir, [number, number, number][]>
      )[d]
      const top = d === 'up' || d === 'down' ? 0 : (1 - h) * 16
      return {
        positions: corners,
        uvs: [
          [0, top],
          [16, top],
          [16, 16],
          [0, 16]
        ],
        texture: '',
        tintindex: 0,
        shade: true,
        dir: d,
        cullface: d,
        onBoundary: false
      }
    })

  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const pi = t.blocks[idx(x, y, z)]
        if (pi === 0) continue
        const inf = info[pi]
        // Fully buried opaque blocks draw nothing: skip them before resolving their (random) variants.
        if (
          inf.occludes &&
          !inf.fluid &&
          occ(x - 1, y, z) &&
          occ(x + 1, y, z) &&
          occ(x, y - 1, z) &&
          occ(x, y + 1, z) &&
          occ(x, y, z - 1) &&
          occ(x, y, z + 1)
        )
          continue
        const col = x + z * sx
        const colors = { grass: grass[col], foliage: foliage[col], water: water[col] }

        let models = inf.baked
        if (inf.positional) {
          const wx = t.originX + x
          const wy = t.originY + y
          const wz = t.originZ + z
          models = resolver.variantsFor(inf.state, [wx, wy, wz]).map((v) => resolver.bake(v))
        }

        for (const m of models) {
          for (const q of m.quads) {
            if (q.cullface) {
              const n = DIR_VEC[q.cullface]
              const ni = at(x + n[0], y + n[1], z + n[2])
              if (info[ni].occludes) continue
              if (inf.selfCulls && ni === pi) continue
            }
            const slot = textures(q.texture)
            if (!slot) continue
            const tint = blockTint(inf.state.name, inf.state.properties, q.tintindex, colors)
            const ao = opts.ambientOcclusion && m.ambientOcclusion && q.onBoundary ? aoFor(q, x, y, z) : null
            emit(q, x, y, z, tint, ao, lightFor(q, x, y, z), slot)
          }
        }

        if (inf.fluid) {
          const same = (dx: number, dy: number, dz: number): boolean =>
            info[at(x + dx, y + dy, z + dz)].fluid === inf.fluid
          const h = same(0, 1, 0) ? 1 : inf.fluidHeight
          const faces = DIRS.filter((d) => {
            const n = DIR_VEC[d]
            if (same(n[0], n[1], n[2])) return false
            if (d === 'up') return true
            return !occ(x + n[0], y + n[1], z + n[2])
          })
          const tex = inf.fluid === 'water' ? 'block/water_still' : 'block/lava_still'
          const slot = textures(tex)
          if (!slot) continue
          const tint = inf.fluid === 'water' ? colors.water : 0xffffff
          const own = lightAt(x, y, z)
          const above = lightAt(x, y + 1, z)
          for (const q of fluidQuads(h, faces)) {
            const l: [number, number] = q.dir === 'up' ? [Math.max(own[0], above[0]), Math.max(own[1], above[1])] : own
            const layer = inf.fluid === 'lava' ? 'opaque' : q.dir === 'up' ? 'waterSurface' : 'translucent'
            emit(q, x, y, z, tint, null, [l, l, l, l], slot, layer)
          }
        }
      }

  return {
    opaque: out.opaque.finish(),
    cutout: out.cutout.finish(),
    translucent: out.translucent.finish(),
    waterSurface: out.waterSurface.finish()
  }
}

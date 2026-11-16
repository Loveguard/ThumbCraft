// Resolves Minecraft blockstates + block models (the JSON files shipped inside the client jar)
// into textured quads, following the vanilla model format:
// https://minecraft.wiki/w/Tutorials/Models#Block_models
import type { BlockState } from '../types'
import { JavaRandom } from './javaRandom'

export type Dir = 'down' | 'up' | 'north' | 'south' | 'west' | 'east'
export const DIRS: Dir[] = ['down', 'up', 'north', 'south', 'west', 'east']
export const DIR_VEC: Record<Dir, [number, number, number]> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0]
}

interface RawFace {
  uv?: [number, number, number, number]
  texture: string
  cullface?: Dir | 'bottom'
  rotation?: number
  tintindex?: number
}
interface RawElement {
  from: [number, number, number]
  to: [number, number, number]
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
  shade?: boolean
  faces: Partial<Record<Dir, RawFace>>
}
interface RawModel {
  parent?: string
  ambientocclusion?: boolean
  textures?: Record<string, string>
  elements?: RawElement[]
}
interface RawVariant {
  model: string
  x?: number
  y?: number
  uvlock?: boolean
  weight?: number
}
interface RawBlockstate {
  variants?: Record<string, RawVariant | RawVariant[]>
  multipart?: { when?: Record<string, unknown>; apply: RawVariant | RawVariant[] }[]
}

export interface Quad {
  /** 4 corners in block space (0..1), ordered TL, TR, BR, BL as seen from outside (clockwise). */
  positions: [number, number, number][]
  /** Per-corner UVs in texture pixels (0..16). */
  uvs: [number, number][]
  /** Texture path without namespace, e.g. "block/stone". */
  texture: string
  tintindex: number
  shade: boolean
  /** World-space face direction after rotation (used for shading). */
  dir: Dir
  /** Neighbour direction that hides this face when that neighbour is a full opaque block. */
  cullface: Dir | null
  /** Face lies flat on the block boundary (eligible for vanilla-style ambient occlusion). */
  onBoundary: boolean
}

export interface BakedModel {
  quads: Quad[]
  ambientOcclusion: boolean
  /** True when the model contains a full 0..16 cube with all six faces present. */
  fullCube: boolean
}

export const stripNs = (id: string): string => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)

export class ModelResolver {
  private bakedCache = new Map<string, BakedModel>()
  private flatCache = new Map<string, { textures: Record<string, string>; elements: RawElement[]; ao: boolean }>()

  constructor(
    private blockstates: Record<string, unknown>,
    private models: Record<string, unknown>
  ) {}

  /** Blocks whose blockstate or model couldn't be read (drawn as nothing instead of breaking the build). */
  readonly failed = new Set<string>()

  /** The model variants vanilla would draw for this block state at this position. */
  variantsFor(state: BlockState, pos: [number, number, number] = [0, 0, 0]): RawVariant[] {
    try {
      const all = this.variantsUnguarded(state, pos)
      const ok = all.filter((v) => typeof v?.model === 'string')
      if (ok.length < all.length) this.failed.add(stripNs(state.name))
      return ok
    } catch (e) {
      this.failed.add(stripNs(state.name))
      console.warn(`Skipping ${state.name}:`, e)
      return []
    }
  }

  private variantsUnguarded(state: BlockState, pos: [number, number, number]): RawVariant[] {
    const bs = this.blockstates[stripNs(state.name)] as RawBlockstate | undefined
    if (!bs) {
      // Air and friends have no blockstate file; anything else missing is worth reporting.
      if (!/(^|[:_])air$|structure_void/.test(state.name)) this.failed.add(stripNs(state.name))
      return []
    }
    if (bs.variants) {
      for (const [key, v] of Object.entries(bs.variants)) {
        if (variantKeyMatches(key, state.properties)) return [pickWeighted(v, pos)]
      }
      return []
    }
    if (bs.multipart) {
      const out: RawVariant[] = []
      for (const part of bs.multipart) {
        if (!part.when || conditionMatches(part.when, state.properties)) out.push(pickWeighted(part.apply, pos))
      }
      return out
    }
    return []
  }

  /** True when the chosen model depends on block position (weighted random variants). */
  isPositional(state: BlockState): boolean {
    const bs = this.blockstates[stripNs(state.name)] as RawBlockstate | undefined
    const multi = (v: RawVariant | RawVariant[]): boolean => Array.isArray(v) && v.length > 1
    if (bs?.variants) return Object.values(bs.variants).some(multi)
    if (bs?.multipart) return bs.multipart.some((p) => multi(p.apply))
    return false
  }

  bake(variant: RawVariant): BakedModel {
    const key = `${variant.model}|${variant.x ?? 0}|${variant.y ?? 0}|${variant.uvlock ? 1 : 0}`
    let baked = this.bakedCache.get(key)
    if (!baked) {
      try {
        baked = this.bakeUncached(variant)
      } catch (e) {
        this.failed.add(String(variant.model))
        console.warn(`Skipping model ${variant.model}:`, e)
        baked = { quads: [], ambientOcclusion: false, fullCube: false }
      }
      this.bakedCache.set(key, baked)
    }
    return baked
  }

  /** Merges the parent chain: child textures override parents; first elements found win. */
  flatten(modelId: string): { textures: Record<string, string>; elements: RawElement[]; ao: boolean } {
    const id = stripNs(modelId)
    const cached = this.flatCache.get(id)
    if (cached) return cached
    const chain: RawModel[] = []
    let cur: string | undefined = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const m = this.models[cur] as RawModel | undefined
      if (!m) break
      chain.push(m)
      cur = m.parent ? stripNs(m.parent) : undefined
    }
    const textures: Record<string, string> = {}
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(textures, chain[i].textures ?? {})
    const elements = chain.find((m) => m.elements)?.elements ?? []
    const ao = chain.find((m) => m.ambientocclusion !== undefined)?.ambientocclusion ?? true
    const flat = { textures, elements, ao }
    this.flatCache.set(id, flat)
    return flat
  }

  private bakeUncached(variant: RawVariant): BakedModel {
    const { textures, elements, ao } = this.flatten(variant.model)
    const quads: Quad[] = []
    const rx = variant.x ?? 0
    const ry = variant.y ?? 0
    let fullCube = false

    for (const el of elements) {
      const [x1, y1, z1] = el.from
      const [x2, y2, z2] = el.to
      const isFull =
        x1 === 0 &&
        y1 === 0 &&
        z1 === 0 &&
        x2 === 16 &&
        y2 === 16 &&
        z2 === 16 &&
        !el.rotation &&
        DIRS.every((d) => el.faces[d])
      if (isFull) fullCube = true

      for (const d of DIRS) {
        const face = el.faces[d]
        if (!face) continue
        const texture = resolveTexture(face.texture, textures)
        if (!texture) continue

        let corners = faceCorners(d, el.from, el.to)
        const uv = face.uv ?? defaultUv(d, el.from, el.to)
        const base: [number, number][] = [
          [uv[0], uv[1]],
          [uv[2], uv[1]],
          [uv[2], uv[3]],
          [uv[0], uv[3]]
        ]
        const k = ((((face.rotation ?? 0) / 90) % 4) + 4) % 4
        let uvs = base.map((_, i) => base[(i - k + 4) % 4])

        if (el.rotation) corners = corners.map((p) => rotateElementPoint(p, el.rotation!))
        // Block-space (0..1), then the blockstate rotation about the block centre.
        let pos = corners.map((p) => [p[0] / 16, p[1] / 16, p[2] / 16] as [number, number, number])
        if (rx || ry) pos = pos.map((p) => rotateVariant(p, rx, ry))

        const dir = rx || ry ? rotateDir(d, rx, ry) : d
        const rawCull = face.cullface === 'bottom' ? 'down' : face.cullface
        const cullface = rawCull ? (rx || ry ? rotateDir(rawCull, rx, ry) : rawCull) : null

        if (variant.uvlock && (rx || ry)) {
          // uvlock keeps textures aligned to the world grid: re-derive UVs from final positions.
          uvs = pos.map((p) => worldAlignedUv(dir, p))
          if (k) uvs = uvs.map((_, i) => uvs[(i - k + 4) % 4])
        }

        quads.push({
          positions: pos,
          uvs,
          texture,
          tintindex: face.tintindex ?? -1,
          shade: el.shade ?? true,
          dir,
          cullface,
          onBoundary: !el.rotation && isOnBoundary(dir, pos)
        })
      }
    }
    nudgeCoplanar(quads)
    return { quads, ambientOcclusion: ao, fullCube }
  }
}

/**
 * Models like grass_block draw an overlay face exactly on top of another face. The game relies on
 * draw order to show the overlay; in a depth-tested renderer the two z-fight (flicker). Push each
 * repeated face a hair outward so the later one always wins, as in-game.
 */
function nudgeCoplanar(quads: Quad[]): void {
  const seen = new Map<string, number>()
  for (const q of quads) {
    const key = q.positions
      .map((p) => p.map((v) => Math.round(v * 1e4)).join(','))
      .sort()
      .join('|')
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    if (!n) continue
    const [dx, dy, dz] = DIR_VEC[q.dir]
    const d = 0.0005 * n
    q.positions = q.positions.map(([x, y, z]) => [x + dx * d, y + dy * d, z + dz * d])
  }
}

function resolveTexture(ref: string, textures: Record<string, string>): string | null {
  let cur = ref
  for (let i = 0; i < 16 && cur.startsWith('#'); i++) {
    const next = textures[cur.slice(1)]
    if (!next) return null
    cur = next
  }
  return cur.startsWith('#') ? null : stripNs(cur)
}

export function variantKeyMatches(key: string, props: Record<string, string>): boolean {
  if (key === '' || key === 'normal') return true
  return key.split(',').every((pair) => {
    const [k, v] = pair.split('=')
    return props[k] === v
  })
}

export function conditionMatches(when: Record<string, unknown>, props: Record<string, string>): boolean {
  if (Array.isArray(when.OR)) return (when.OR as Record<string, unknown>[]).some((c) => conditionMatches(c, props))
  if (Array.isArray(when.AND)) return (when.AND as Record<string, unknown>[]).every((c) => conditionMatches(c, props))
  return Object.entries(when).every(([k, v]) => {
    const raw = String(v)
    const negate = raw.startsWith('!')
    const options = (negate ? raw.slice(1) : raw).split('|')
    const hit = options.includes(props[k] ?? '')
    return negate ? !hit : hit
  })
}

/** Vanilla Mth.getSeed(BlockPos), used to pick weighted model variants per position. */
export function positionSeed(x: number, y: number, z: number): bigint {
  // Note: vanilla multiplies x as a 32-bit int before widening to long.
  let l = BigInt.asIntN(64, BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y))
  l = BigInt.asIntN(64, l * l * 42317861n + l * 11n)
  return l >> 16n
}

function pickWeighted(v: RawVariant | RawVariant[], pos: [number, number, number]): RawVariant {
  if (!Array.isArray(v)) return v
  if (v.length === 1) return v[0]
  const total = v.reduce((s, x) => s + (x.weight ?? 1), 0)
  let r = new JavaRandom(positionSeed(pos[0], pos[1], pos[2])).nextInt(total)
  for (const x of v) {
    r -= x.weight ?? 1
    if (r < 0) return x
  }
  return v[0]
}

/** Default face UVs when a model omits "uv" (vanilla BlockElement#uvsByFace). */
export function defaultUv(d: Dir, from: number[], to: number[]): [number, number, number, number] {
  const [x1, y1, z1] = from
  const [x2, y2, z2] = to
  switch (d) {
    case 'down':
      return [x1, 16 - z2, x2, 16 - z1]
    case 'up':
      return [x1, z1, x2, z2]
    case 'north':
      return [16 - x2, 16 - y2, 16 - x1, 16 - y1]
    case 'south':
      return [x1, 16 - y2, x2, 16 - y1]
    case 'west':
      return [z1, 16 - y2, z2, 16 - y1]
    case 'east':
      return [16 - z2, 16 - y2, 16 - z1, 16 - y1]
  }
}

/** UV a texture would have at point p if it were laid on the world grid (used for uvlock). */
function worldAlignedUv(d: Dir, p: [number, number, number]): [number, number] {
  const [x, y, z] = p.map((v) => v * 16)
  switch (d) {
    case 'down':
      return [x, 16 - z]
    case 'up':
      return [x, z]
    case 'north':
      return [16 - x, 16 - y]
    case 'south':
      return [x, 16 - y]
    case 'west':
      return [z, 16 - y]
    case 'east':
      return [16 - z, 16 - y]
  }
}

/** Corners TL, TR, BR, BL (viewed from outside) — consistent with defaultUv. */
export function faceCorners(d: Dir, from: number[], to: number[]): [number, number, number][] {
  const [x1, y1, z1] = from
  const [x2, y2, z2] = to
  switch (d) {
    case 'north':
      return [
        [x2, y2, z1],
        [x1, y2, z1],
        [x1, y1, z1],
        [x2, y1, z1]
      ]
    case 'south':
      return [
        [x1, y2, z2],
        [x2, y2, z2],
        [x2, y1, z2],
        [x1, y1, z2]
      ]
    case 'west':
      return [
        [x1, y2, z1],
        [x1, y2, z2],
        [x1, y1, z2],
        [x1, y1, z1]
      ]
    case 'east':
      return [
        [x2, y2, z2],
        [x2, y2, z1],
        [x2, y1, z1],
        [x2, y1, z2]
      ]
    case 'up':
      return [
        [x1, y2, z1],
        [x2, y2, z1],
        [x2, y2, z2],
        [x1, y2, z2]
      ]
    case 'down':
      return [
        [x1, y1, z2],
        [x2, y1, z2],
        [x2, y1, z1],
        [x1, y1, z1]
      ]
  }
}

function rotateElementPoint(
  p: [number, number, number],
  rot: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
): [number, number, number] {
  const a = (rot.angle * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const scale = rot.rescale ? 1 / Math.cos(Math.abs(a)) : 1
  const [ox, oy, oz] = rot.origin
  let x = p[0] - ox
  let y = p[1] - oy
  let z = p[2] - oz
  if (rot.axis === 'x') [y, z] = [(y * c - z * s) * scale, (y * s + z * c) * scale]
  else if (rot.axis === 'y') [x, z] = [(x * c + z * s) * scale, (-x * s + z * c) * scale]
  else [x, y] = [(x * c - y * s) * scale, (x * s + y * c) * scale]
  return [x + ox, y + oy, z + oz]
}

/**
 * Blockstate rotation. Vanilla builds it as rotateYXZ(-y, -x, 0), i.e. rotate about X by -x
 * first, then about Y by -y (right-handed), around the block centre.
 */
export function rotateVariant(p: [number, number, number], xDeg: number, yDeg: number): [number, number, number] {
  let x = p[0] - 0.5
  let y = p[1] - 0.5
  let z = p[2] - 0.5
  if (xDeg) {
    const a = (-xDeg * Math.PI) / 180
    const c = Math.round(Math.cos(a))
    const s = Math.round(Math.sin(a))
    ;[y, z] = [y * c - z * s, y * s + z * c]
  }
  if (yDeg) {
    const a = (-yDeg * Math.PI) / 180
    const c = Math.round(Math.cos(a))
    const s = Math.round(Math.sin(a))
    ;[x, z] = [x * c + z * s, -x * s + z * c]
  }
  return [x + 0.5, y + 0.5, z + 0.5]
}

export function rotateDir(d: Dir, xDeg: number, yDeg: number): Dir {
  const v = rotateVariant(DIR_VEC[d].map((c) => c * 0.5 + 0.5) as [number, number, number], xDeg, yDeg).map((c) =>
    Math.round((c - 0.5) * 2)
  )
  return DIRS.find((k) => DIR_VEC[k].every((c, i) => c === v[i]))!
}

function isOnBoundary(d: Dir, pos: [number, number, number][]): boolean {
  const axis = d === 'west' || d === 'east' ? 0 : d === 'down' || d === 'up' ? 1 : 2
  const target = d === 'east' || d === 'up' || d === 'south' ? 1 : 0
  return pos.every((p) => Math.abs(p[axis] - target) < 1e-6)
}

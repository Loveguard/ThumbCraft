// Item models as the game builds them: flat sprites ("item/generated") are extruded 1px thick with a side
// face on every pixel edge (ItemModelGenerator); everything else is an ordinary block-style model. Each model
// carries "display" transforms saying how to hold it.
import { stripNs } from './blockModel'

export interface ItemTransform {
  rotation: [number, number, number]
  /** In pixels (1/16 block), as written in the model file. */
  translation: [number, number, number]
  scale: [number, number, number]
}

export type ResolvedItem =
  | { kind: 'generated'; layers: string[]; display: Record<string, ItemTransform> }
  | { kind: 'model'; model: string; display: Record<string, ItemTransform> }

interface RawItemModel {
  parent?: string
  textures?: Record<string, string>
  elements?: unknown[]
  display?: Record<string, Partial<ItemTransform>>
}

const IDENTITY: ItemTransform = { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] }

/** Follows an item model's parents. Returns null for models the game draws in code (shields, chests…). */
export function resolveItem(models: Record<string, unknown>, id: string): ResolvedItem | null {
  const chain: RawItemModel[] = []
  let cur: string | undefined = `item/${stripNs(id)}`
  let generated = false
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    if (cur === 'builtin/generated') {
      generated = true
      break
    }
    if (cur === 'builtin/entity') return null
    const m = models[cur] as RawItemModel | undefined
    if (!m) break
    chain.push(m)
    cur = m.parent ? stripNs(m.parent) : undefined
  }
  if (!chain.length) return null
  // Each display context comes from the nearest model in the chain that defines it.
  const display: Record<string, ItemTransform> = {}
  for (let i = chain.length - 1; i >= 0; i--)
    for (const [ctx, t] of Object.entries(chain[i].display ?? {}))
      display[ctx] = {
        rotation: (t.rotation ?? IDENTITY.rotation) as ItemTransform['rotation'],
        translation: (t.translation ?? IDENTITY.translation) as ItemTransform['translation'],
        scale: (t.scale ?? IDENTITY.scale) as ItemTransform['scale']
      }
  const textures: Record<string, string> = {}
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(textures, chain[i].textures ?? {})
  if (generated) {
    const layers: string[] = []
    for (let i = 0; textures[`layer${i}`]; i++) layers.push(stripNs(textures[`layer${i}`]))
    return layers.length ? { kind: 'generated', layers, display } : null
  }
  if (!chain.some((m) => m.elements)) return null
  return { kind: 'model', model: `item/${stripNs(id)}`, display }
}

/** Item ids with a drawable model, sorted. Templates and internal parents are skipped. */
export function listItems(models: Record<string, unknown>): string[] {
  return Object.keys(models)
    .filter((k) => k.startsWith('item/'))
    .map((k) => k.slice(5))
    .filter((id) => !/^(generated$|handheld|template_)/.test(id))
    .filter((id) => {
      const r = resolveItem(models, id)
      return !!r && (r.kind === 'model' || !r.layers.some((l) => l.includes('#')))
    })
    .sort()
}

/** Texture to show for an item in a picker. */
export function itemIcon(models: Record<string, unknown>, id: string): string | null {
  const r = resolveItem(models, id)
  if (!r) return null
  if (r.kind === 'generated') return r.layers[0]
  const m = models[`item/${id}`] as RawItemModel | undefined
  const parent = m?.parent ? stripNs(m.parent) : ''
  // Block items: show the block's side/all/particle texture.
  const block = models[parent] as RawItemModel | undefined
  const tex = { ...(block?.textures ?? {}), ...(m?.textures ?? {}) }
  const pick = tex.all ?? tex.side ?? tex.texture ?? tex.particle ?? tex.top ?? Object.values(tex)[0]
  return pick && !pick.startsWith('#') ? stripNs(pick) : null
}

export interface ItemQuad {
  /** Model-space corners in pixels (0–16), outward winding TL, TR, BR, BL. */
  corners: [number, number, number][]
  /** Texture-space UVs (0–1, v down) for the same corners. */
  uvs: [number, number][]
  normal: [number, number, number]
}

/**
 * ItemModelGenerator: a sprite becomes a 1px-thick slab (z 7.5–8.5) with front and back faces plus a side
 * face along every edge between an opaque and a transparent pixel. `alpha(x, y)` reads the sprite (y down).
 */
export function generatedItemQuads(w: number, h: number, alpha: (x: number, y: number) => number): ItemQuad[] {
  const sx = 16 / w
  const sy = 16 / h
  const z0 = 7.5
  const z1 = 8.5
  const quads: ItemQuad[] = [
    {
      corners: [
        [0, 16, z1],
        [16, 16, z1],
        [16, 0, z1],
        [0, 0, z1]
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ],
      normal: [0, 0, 1]
    },
    {
      corners: [
        [16, 16, z0],
        [0, 16, z0],
        [0, 0, z0],
        [16, 0, z0]
      ],
      uvs: [
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1]
      ],
      normal: [0, 0, -1]
    }
  ]
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && alpha(x, y) > 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue
      // Each side face samples the middle of its own pixel.
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      const uv: [number, number][] = [
        [u, v],
        [u, v],
        [u, v],
        [u, v]
      ]
      const left = x * sx
      const right = (x + 1) * sx
      const top = 16 - y * sy
      const bottom = 16 - (y + 1) * sy
      if (!solid(x - 1, y))
        quads.push({
          corners: [
            [left, top, z0],
            [left, top, z1],
            [left, bottom, z1],
            [left, bottom, z0]
          ],
          uvs: uv,
          normal: [-1, 0, 0]
        })
      if (!solid(x + 1, y))
        quads.push({
          corners: [
            [right, top, z1],
            [right, top, z0],
            [right, bottom, z0],
            [right, bottom, z1]
          ],
          uvs: uv,
          normal: [1, 0, 0]
        })
      if (!solid(x, y - 1))
        quads.push({
          corners: [
            [left, top, z0],
            [right, top, z0],
            [right, top, z1],
            [left, top, z1]
          ],
          uvs: uv,
          normal: [0, 1, 0]
        })
      if (!solid(x, y + 1))
        quads.push({
          corners: [
            [left, bottom, z1],
            [right, bottom, z1],
            [right, bottom, z0],
            [left, bottom, z0]
          ],
          uvs: uv,
          normal: [0, -1, 0]
        })
    }
  return quads
}

// Armor and held items on player models, built from the user's own game files.
import * as THREE from 'three'
import { DIR_VEC } from '@shared/minecraft/blockModel'
import { generatedItemQuads, resolveItem, type ItemTransform } from '@shared/minecraft/items'
import {
  ARMOR_SLOTS,
  armorBoxes,
  boxFaces,
  playerParts,
  PLAYER_PIXEL,
  type ArmorSlot,
  type BoxDef
} from '@shared/minecraft/playerModel'
import { blockTint, sampleColormap, type BiomeColors } from '@shared/minecraft/tints'
import type { Equipment } from '../store'
import { assetUrl, imageData, loadImage, type AssetContext } from './assets'
import { boxGeometry, disposeObject } from './builders'
import { buildOutfit } from './outfits'

export interface ArmorMaterial {
  id: string
  label: string
  /** Slots this material exists for in the loaded version. */
  slots: ArmorSlot[]
  dyeable: boolean
}

const LABELS: Record<string, string> = { gold: 'Golden', turtle_scute: 'Turtle shell', turtle: 'Turtle shell' }
const label = (id: string): string => LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' ')

/** 1.21.2+ keeps armor textures in entity/equipment; older versions use models/armor/<id>_layer_N. */
const isNewFormat = (textures: string[]): boolean => textures.some((t) => t.startsWith('entity/equipment/humanoid/'))

function armorTexture(textures: string[], id: string, slot: ArmorSlot, overlay = false): string {
  if (isNewFormat(textures))
    return `entity/equipment/${slot === 'legs' ? 'humanoid_leggings' : 'humanoid'}/${id}${overlay ? '_overlay' : ''}`
  return `models/armor/${id}_layer_${slot === 'legs' ? 2 : 1}${overlay ? '_overlay' : ''}`
}

/** Armor materials available in the loaded game version, read from its texture list. */
export function armorMaterials(textures: string[]): ArmorMaterial[] {
  const set = new Set(textures)
  const ids = new Set<string>()
  for (const t of textures) {
    const m = /^entity\/equipment\/humanoid(?:_leggings)?\/(.+)$/.exec(t) ?? /^models\/armor\/(.+?)_layer_[12]$/.exec(t)
    if (m && !m[1].endsWith('_overlay')) ids.add(m[1])
  }
  const order = ['leather', 'chainmail', 'iron', 'gold', 'diamond', 'netherite', 'turtle_scute', 'turtle']
  return [...ids]
    .filter((id) => !/^(armadillo|llama|horse|wolf|elytra)/.test(id))
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map((id) => {
      const helmetOnly = id.startsWith('turtle')
      const slots = ARMOR_SLOTS.filter((s) => (!helmetOnly || s === 'head') && set.has(armorTexture(textures, id, s)))
      return { id, label: label(id), slots, dyeable: set.has(armorTexture(textures, id, 'chest', true)) }
    })
    .filter((m) => m.slots.length > 0)
}

async function pixelTexture(path: string): Promise<THREE.Texture | null> {
  const img = await loadImage(assetUrl(path))
  if (!img) return null
  const t = new THREE.Texture(img)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

async function buildArmor(
  ctx: AssetContext,
  slot: ArmorSlot,
  id: string,
  slim: boolean,
  dye: string
): Promise<{ part: string; mesh: THREE.Mesh }[]> {
  const textures = ctx.bundle.textures
  const layers = [{ path: armorTexture(textures, id, slot), tint: id === 'leather' ? dye : null }]
  if (id === 'leather') layers.push({ path: armorTexture(textures, id, slot, true), tint: null })
  const out: { part: string; mesh: THREE.Mesh }[] = []
  for (const [i, layer] of layers.entries()) {
    const tex = await pixelTexture(layer.path)
    if (!tex) continue
    const { width, height } = tex.image as HTMLImageElement
    // Vanilla draws armor as cutout with no back-face culling.
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      color: layer.tint ?? '#ffffff',
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      polygonOffset: i > 0,
      polygonOffsetFactor: -i,
      polygonOffsetUnits: -i
    })
    for (const { part, box } of armorBoxes(slot, slim)) {
      const mesh = new THREE.Mesh(boxGeometry(boxFaces(box), width, height), mat)
      mesh.castShadow = true
      out.push({ part, mesh })
    }
  }
  return out
}

/** Where vanilla's shield texture lives (the plain one, before any banner pattern). */
export const SHIELD_TEXTURE = 'entity/shield_base_nopattern'

/** Vanilla's shield.json display transforms (used when the jar's own aren't found). */
const SHIELD_DISPLAY: Record<string, ItemTransform> = {
  thirdperson_righthand: { rotation: [0, 90, 0], translation: [10, 6, -4], scale: [1, 1, 1] },
  thirdperson_lefthand: { rotation: [0, 90, 0], translation: [10, 6, 12], scale: [1, 1, 1] }
}

/**
 * The shield, which the game draws with entity code instead of an item model: ShieldModel's 12×22×1 plate and
 * 2×6×6 handle, in item space (the vanilla entity model turned the way the item renderer turns it).
 */
async function buildShield(
  ctx: AssetContext
): Promise<{ object: THREE.Object3D; display: Record<string, ItemTransform> } | null> {
  const tex = await pixelTexture(SHIELD_TEXTURE)
  if (!tex) return null
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide })
  const group = new THREE.Group()
  const boxes: BoxDef[] = [
    { from: [-6, -11, 1], to: [6, 11, 2], uv: [0, 0], inflate: 0, overlay: false },
    { from: [-1, -3, -5], to: [1, 3, 1], uv: [26, 0], inflate: 0, overlay: false }
  ]
  for (const b of boxes) {
    const mesh = new THREE.Mesh(boxGeometry(boxFaces(b), 64, 64), mat)
    mesh.castShadow = true
    group.add(mesh)
  }
  // boxGeometry works in player pixels; item space is 16 pixels to the block. The game draws the model around
  // the item's corner (after the item renderer's half-block shift), not its centre.
  group.scale.setScalar(1 / (16 * PLAYER_PIXEL))
  const outer = new THREE.Group()
  outer.add(group)
  const own = (ctx.bundle.models['item/shield'] as { display?: Record<string, ItemTransform> } | undefined)?.display
  return { object: outer, display: { ...SHIELD_DISPLAY, ...own } }
}

/** An item model in block units (0–1), plus how it is held. */
async function buildItem(
  ctx: AssetContext,
  id: string
): Promise<{ object: THREE.Object3D; display: Record<string, ItemTransform> } | null> {
  if (id === 'shield' || id === 'minecraft:shield') return buildShield(ctx)
  const item = resolveItem(ctx.bundle.models, id)
  if (!item) return null
  const group = new THREE.Group()
  if (item.kind === 'generated') {
    for (const [i, layer] of item.layers.entries()) {
      const img = await loadImage(assetUrl(layer))
      if (!img) continue
      const size = Math.min(img.width, img.height) // first frame of animated sprites
      const px = imageData(img, size, size)
      const quads = generatedItemQuads(size, size, (x, y) => px.data[(y * size + x) * 4 + 3])
      const pos: number[] = []
      const nrm: number[] = []
      const uv: number[] = []
      const idx: number[] = []
      for (const q of quads) {
        const base = pos.length / 3
        q.corners.forEach((c, k) => {
          pos.push(c[0] / 16, c[1] / 16, c[2] / 16)
          nrm.push(...q.normal)
          uv.push(q.uvs[k][0], 1 - q.uvs[k][1])
        })
        idx.push(base, base + 3, base + 2, base, base + 2, base + 1)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(idx)
      const c = document.createElement('canvas')
      c.width = c.height = size
      c.getContext('2d')!.putImageData(px, 0, 0)
      const tex = new THREE.CanvasTexture(c)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.colorSpace = THREE.SRGBColorSpace
      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        alphaTest: 0.1,
        polygonOffset: i > 0,
        polygonOffsetFactor: -i,
        polygonOffsetUnits: -i
      })
      const mesh = new THREE.Mesh(g, mat)
      mesh.castShadow = true
      group.add(mesh)
    }
  } else {
    const baked = ctx.resolver.bake({ model: item.model })
    const atlas = await ctx.buildAtlas(baked.quads.map((q) => q.texture))
    const maps = await ctx.colormaps()
    // Held grass and leaves use the game's default item colours (the colormap at 0.5 temperature, 1.0 rain).
    const colors: BiomeColors = {
      grass: sampleColormap(maps.grass, 0.5, 1, 0x91bd59),
      foliage: sampleColormap(maps.foliage, 0.5, 1, 0x77ab2f),
      water: 0x3f76e4
    }
    const pos: number[] = []
    const nrm: number[] = []
    const uv: number[] = []
    const col: number[] = []
    const idx: number[] = []
    for (const q of baked.quads) {
      const slot = atlas.slots.get(q.texture)
      if (!slot) continue
      const tint = new THREE.Color(blockTint(id, {}, q.tintindex, colors)).convertSRGBToLinear()
      const base = pos.length / 3
      q.positions.forEach((p, k) => {
        pos.push(...p)
        nrm.push(...DIR_VEC[q.dir])
        uv.push(slot.u0 + (q.uvs[k][0] / 16) * (slot.u1 - slot.u0), slot.v0 + (q.uvs[k][1] / 16) * (slot.v1 - slot.v0))
        col.push(tint.r, tint.g, tint.b)
      })
      idx.push(base, base + 3, base + 2, base, base + 2, base + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })
    )
    mesh.castShadow = true
    group.add(mesh)
  }
  return { object: group, display: item.display }
}

/**
 * Places an item in a hand the way vanilla does (HumanoidModel.translateToHand + ItemInHandLayer), then
 * applies the model's own third-person display transform. Attached to the forearm so it follows the elbow.
 */
function holdItem(
  player: THREE.Object3D,
  item: THREE.Object3D,
  display: Record<string, ItemTransform>,
  left: boolean,
  slim: boolean
): void {
  const forearm = player.getObjectByName(left ? 'leftForearm' : 'rightForearm')
  if (!forearm) return
  const elbow = playerParts(slim).find((p) => p.name === (left ? 'leftForearm' : 'rightForearm'))!.pivot
  // Vanilla model space (y down, facing -Z) at the shoulder; our parts use y up, facing +Z (a 180° turn about X).
  const shoulder = new THREE.Group()
  shoulder.position.set(-elbow[0] * PLAYER_PIXEL, -elbow[1] * PLAYER_PIXEL, -elbow[2] * PLAYER_PIXEL)
  shoulder.rotation.x = Math.PI
  shoulder.scale.setScalar(16 * PLAYER_PIXEL) // vanilla units are blocks; the player is drawn at 0.9375 scale
  const turn = new THREE.Group()
  turn.rotation.x = THREE.MathUtils.degToRad(-90)
  const turn2 = new THREE.Group()
  turn2.rotation.y = Math.PI
  const hand = new THREE.Group()
  hand.position.set((left ? -1 : 1) / 16, 0.125, -0.625)
  const t = display[left ? 'thirdperson_lefthand' : 'thirdperson_righthand'] ?? display.thirdperson_righthand
  const fit = new THREE.Group()
  if (t) {
    const i = left ? -1 : 1
    const clamp = (v: number): number => Math.max(-80, Math.min(80, v)) / 16
    fit.position.set(i * clamp(t.translation[0]), clamp(t.translation[1]), clamp(t.translation[2]))
    const d = THREE.MathUtils.degToRad
    fit.rotation.set(d(t.rotation[0]), d(t.rotation[1]) * i, d(t.rotation[2]) * i, 'XYZ')
    fit.scale.set(...t.scale)
  }
  item.position.set(-0.5, -0.5, -0.5)
  fit.add(item)
  hand.add(fit)
  turn2.add(hand)
  turn.add(turn2)
  shoulder.add(turn)
  shoulder.userData.equipment = true
  forearm.add(shoulder)
}

/** Replaces the armor and held items on a built player model. Stale results are dropped via `alive()`. */
export async function applyEquipment(
  player: THREE.Object3D,
  eq: Equipment,
  slim: boolean,
  ctx: AssetContext,
  alive: () => boolean
): Promise<void> {
  const added: { parent: THREE.Object3D; object: THREE.Object3D }[] = []
  // An outfit replaces the armour (its suit is drawn on the armour layout).
  const outfit = eq.outfit ? buildOutfit(eq.outfit, slim) : null
  for (const { part, object } of outfit?.parts ?? []) {
    const parent = player.getObjectByName(part)
    if (parent) added.push({ parent, object })
  }
  for (const slot of outfit ? [] : ARMOR_SLOTS) {
    const id = eq[slot]
    if (!id) continue
    for (const { part, mesh } of await buildArmor(ctx, slot, id, slim, eq.leatherColor)) {
      const parent = player.getObjectByName(part)
      if (parent) added.push({ parent, object: mesh })
    }
  }
  const items: { id: string; left: boolean }[] = []
  if (eq.mainHand) items.push({ id: eq.mainHand, left: false })
  if (eq.offHand) items.push({ id: eq.offHand, left: true })
  const built = await Promise.all(items.map(async (it) => ({ it, item: await buildItem(ctx, it.id) })))
  if (!alive()) return

  // Swap in one go so the model never shows half-dressed.
  const old: THREE.Object3D[] = []
  player.traverse((o) => o.userData.equipment && old.push(o))
  for (const o of old) {
    o.removeFromParent()
    disposeObject(o)
  }
  for (const { parent, object } of added) {
    object.userData.equipment = true
    parent.add(object)
  }
  for (const { it, item } of built) if (item) holdItem(player, item.object, item.display, it.left, slim)
  // The outfit's staff or sceptre, unless the main hand already holds something.
  if (outfit?.held && !eq.mainHand) holdItem(player, outfit.held.object, outfit.held.display, false, slim)
}

// Custom outfits for players (not from the game): a king, an astronaut, a soldier and a wizard. The suit itself
// is painted onto the armour layout, so it bends with the joints like armour does; capes, packs, hats and the
// staffs are extra pieces on the head, the body or in the hand. The cloth is real fabric (seamless tiles made from
// the outfit swatch pack), so suits are painted at four texels per pixel.
import * as THREE from 'three'
import { armorBoxes, boxFaces, PLAYER_PIXEL, type ArmorSlot, type PartName } from '@shared/minecraft/playerModel'
import type { ItemTransform } from '@shared/minecraft/items'
import { boxGeometry } from './builders'
import velvetUrl from '../assets/outfits/velvet.png'
import ermineUrl from '../assets/outfits/ermine.png'
import filigreeUrl from '../assets/outfits/filigree.png'
import spacesuitUrl from '../assets/outfits/spacesuit.png'
import camoUrl from '../assets/outfits/camo.png'
import starrobeUrl from '../assets/outfits/starrobe.png'
import webbingUrl from '../assets/outfits/webbing.png'
import leatherUrl from '../assets/outfits/leather.png'

export type OutfitId = 'king' | 'astronaut' | 'soldier' | 'wizard'

export const OUTFITS: { id: OutfitId; label: string; hint: string }[] = [
  { id: 'king', label: 'King', hint: 'Crown, red velvet cloak with an ermine collar and a gold sceptre' },
  {
    id: 'astronaut',
    label: 'Astronaut',
    hint: 'Quilted white space suit, gold-visored helmet and a life-support pack'
  },
  { id: 'soldier', label: 'Soldier', hint: 'Camo uniform, combat helmet, webbing vest and a field pack' },
  { id: 'wizard', label: 'Wizard', hint: 'Pointed hat, starry robe and a staff with a glowing orb' }
]

/** Fabric tiles: 128px squares that repeat seamlessly, each spanning 32 pixels of the model. */
type FabricId = 'velvet' | 'ermine' | 'filigree' | 'spacesuit' | 'camo' | 'starrobe' | 'webbing' | 'leather'
const FABRICS: Record<FabricId, { url: string; average: string }> = {
  velvet: { url: velvetUrl, average: '#c90c25' },
  ermine: { url: ermineUrl, average: '#dad9d9' },
  filigree: { url: filigreeUrl, average: '#c4a551' },
  spacesuit: { url: spacesuitUrl, average: '#d4d4d4' },
  camo: { url: camoUrl, average: '#6a5f41' },
  starrobe: { url: starrobeUrl, average: '#571851' },
  webbing: { url: webbingUrl, average: '#758860' },
  leather: { url: leatherUrl, average: '#5b4741' }
}
const FABRIC_SPAN = 32
/** Texels per model pixel on a suit texture. */
const SUIT_SCALE = 4

type FabricImages = Partial<Record<FabricId, HTMLImageElement>>
let fabricImages: Promise<FabricImages> | null = null
/** Loads every fabric once; one that fails to load is left out and painted in its average colour. */
function loadFabrics(): Promise<FabricImages> {
  fabricImages ??= Promise.all(
    (Object.keys(FABRICS) as FabricId[]).map(async (id) => {
      const img = new Image()
      img.src = FABRICS[id].url
      try {
        await img.decode()
        return [id, img] as const
      } catch {
        return [id, null] as const
      }
    })
  ).then((entries) => Object.fromEntries(entries.filter(([, img]) => img)) as FabricImages)
  return fabricImages
}

type G = CanvasRenderingContext2D
type Paint = string | CanvasPattern
type Rect = [number, number, number, number]
/** Fill styles for each fabric on one canvas. */
type Fabrics = Record<FabricId, Paint>

function fabricStyles(g: G, images: FabricImages): Fabrics {
  const out = {} as Fabrics
  for (const id of Object.keys(FABRICS) as FabricId[]) {
    const img = images[id]
    const pattern = img ? g.createPattern(img, 'repeat') : null
    // The canvas is drawn in model pixels; a tile spans FABRIC_SPAN of them.
    if (img && pattern) pattern.setTransform(new DOMMatrix().scale(FABRIC_SPAN / img.width))
    out[id] = pattern ?? FABRICS[id].average
  }
  return out
}

/** The six face rectangles of a box's UV net (the game's layout): top, bottom, right, front, left, back. */
function net(u: number, v: number, w: number, h: number, d: number): Record<string, Rect> {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h]
  }
}
const HEAD = net(0, 0, 8, 8, 8)
const BODY = net(16, 16, 8, 12, 4)
const ARM = net(40, 16, 4, 12, 4)
const LEG = net(0, 16, 4, 12, 4)
const SIDES = ['right', 'front', 'left', 'back'] as const

const fill = (g: G, c: Paint, [x, y, w, h]: Rect): void => {
  g.fillStyle = c
  g.fillRect(x, y, w, h)
}
const fillNet = (g: G, c: Paint, n: Record<string, Rect>): void => {
  for (const r of Object.values(n)) fill(g, c, r)
}
/** Rows [from, to) of every side face of a box (row 0 is the top). */
const band = (g: G, c: Paint, n: Record<string, Rect>, from: number, to: number): void => {
  for (const s of SIDES) {
    const [x, y, w] = n[s]
    fill(g, c, [x, y + from, w, to - from])
  }
}
/** Darkens a net by `amount` (0…1), for the shadowed under-layer of a suit. */
const shade = (g: G, n: Record<string, Rect>, amount: number): void => fillNet(g, `rgba(0, 0, 0, ${amount})`, n)

/** The two armour-layout textures of a suit: layer 1 (helmet, body, arms, boots) and layer 2 (waist, legs). */
interface SuitArt {
  layer1: (g: G, f: Fabrics) => void
  layer2: (g: G, f: Fabrics) => void
  /** Whether layer 1 paints a helmet (otherwise the head is left bare for a hat or crown). */
  helmet: boolean
}

const SUITS: Record<OutfitId, SuitArt> = {
  king: {
    helmet: false,
    layer1: (g, f) => {
      fillNet(g, f.velvet, BODY)
      fill(g, f.filigree, [23, 20, 2, 12]) // gold placket down the front
      band(g, f.filigree, BODY, 9, 10) // belt
      fill(g, '#f7e08a', [23, 29, 2, 1]) // buckle
      fillNet(g, f.velvet, ARM)
      band(g, f.filigree, ARM, 10, 12) // cuffs
      band(g, f.leather, LEG, 8, 12) // boots
      fill(g, '#2a140c', LEG.bottom)
    },
    layer2: (g, f) => {
      fillNet(g, f.velvet, BODY)
      fillNet(g, f.velvet, LEG)
      shade(g, BODY, 0.45)
      shade(g, LEG, 0.45)
      band(g, f.filigree, BODY, 0, 1)
    }
  },
  astronaut: {
    helmet: true,
    layer1: (g, f) => {
      fillNet(g, f.spacesuit, HEAD)
      fill(g, '#c5ccd6', [8, 8, 8, 1])
      // Gold visor across the front, with a glint.
      fill(g, '#b9862c', [9, 10, 6, 4])
      fill(g, '#e9c46a', [9, 10, 6, 1])
      fill(g, '#fff3c4', [10, 11, 1, 1])
      fill(g, '#8a5a1c', [9, 13, 6, 1])
      fillNet(g, f.spacesuit, BODY)
      band(g, '#c5ccd6', BODY, 0, 1)
      // Chest control panel.
      fill(g, '#9aa4b2', [21, 22, 4, 3])
      fill(g, '#e63946', [22, 23, 1, 1])
      fill(g, '#2f80ed', [24, 23, 1, 1])
      fill(g, '#ffd166', [23, 24, 1, 1])
      fill(g, '#2f80ed', [26, 21, 1, 2]) // flag patch
      fillNet(g, f.spacesuit, ARM)
      band(g, '#c5ccd6', ARM, 5, 6)
      band(g, '#9aa4b2', ARM, 10, 12) // gloves
      band(g, '#9aa4b2', LEG, 8, 12) // boots
      fill(g, '#6b7380', LEG.bottom)
    },
    layer2: (g, f) => {
      fillNet(g, f.spacesuit, BODY)
      fillNet(g, f.spacesuit, LEG)
      band(g, '#c5ccd6', LEG, 5, 6) // knee joints
      band(g, '#9aa4b2', BODY, 0, 1)
    }
  },
  soldier: {
    helmet: true,
    layer1: (g, f) => {
      // A combat helmet: the top and the upper rows of the head only.
      fill(g, f.camo, HEAD.top)
      for (const s of SIDES) {
        const [x, y, w] = HEAD[s]
        fill(g, f.camo, [x, y, w, 3])
        fill(g, '#2f3a1a', [x, y + 3, w, 1]) // rim
      }
      fill(g, '#2b2b22', [8, 12, 1, 3]) // chin strap
      fill(g, '#2b2b22', [15, 12, 1, 3])
      fillNet(g, f.camo, BODY)
      fillNet(g, f.camo, ARM)
      // Webbing vest over the chest and back, with pouches.
      fill(g, f.webbing, [20, 20, 8, 8])
      fill(g, '#2c3122', [21, 25, 2, 2])
      fill(g, '#2c3122', [25, 25, 2, 2])
      fill(g, f.webbing, [32, 20, 8, 8])
      band(g, '#2c3122', BODY, 8, 9) // belt
      band(g, '#1f1f1c', LEG, 8, 12) // boots
      fill(g, '#141412', LEG.bottom)
    },
    layer2: (g, f) => {
      fillNet(g, f.camo, BODY)
      fillNet(g, f.camo, LEG)
      shade(g, LEG, 0.15)
    }
  },
  wizard: {
    helmet: false,
    layer1: (g, f) => {
      fillNet(g, f.starrobe, BODY)
      band(g, '#f2c14e', BODY, 9, 10)
      fill(g, '#7a2a72', [23, 20, 2, 9]) // robe opening
      fillNet(g, f.starrobe, ARM)
      band(g, '#7a2a72', ARM, 9, 12) // wide cuffs
      band(g, f.leather, LEG, 9, 12) // shoes
    },
    layer2: (g, f) => {
      fillNet(g, f.starrobe, BODY)
      fillNet(g, f.starrobe, LEG)
      shade(g, LEG, 0.2)
    }
  }
}

function suitTexture(paint: (g: G, f: Fabrics) => void, images: FabricImages): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64 * SUIT_SCALE
  c.height = 32 * SUIT_SCALE
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.scale(SUIT_SCALE, SUIT_SCALE)
  paint(g, fabricStyles(g, images))
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A flat-coloured box in a part's space, given in pixels. */
function block(
  mat: THREE.Material,
  [x0, y0, z0]: [number, number, number],
  [x1, y1, z1]: [number, number, number]
): THREE.Mesh {
  const px = PLAYER_PIXEL
  const m = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * px, (y1 - y0) * px, (z1 - z0) * px), mat)
  m.position.set(((x0 + x1) / 2) * px, ((y0 + y1) / 2) * px, ((z0 + z1) / 2) * px)
  m.castShadow = true
  return m
}
const mat = (color: string, glow = 0): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: glow })

type Vec = [number, number, number]
/** A box covered in fabric at the same scale as the suits, `tint` darkening it; flat colour if the tile is missing. */
function clothBlock(images: FabricImages, id: FabricId, a: Vec, b: Vec, tint = '#ffffff'): THREE.Mesh {
  const img = images[id]
  if (!img) return block(mat(FABRICS[id].average), a, b)
  const t = new THREE.Texture(img)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set((b[0] - a[0]) / FABRIC_SPAN, (b[1] - a[1]) / FABRIC_SPAN)
  t.magFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return block(new THREE.MeshLambertMaterial({ map: t, color: tint }), a, b)
}

/** A gold crown on the head (the head spans y 0…8 in its part's space). */
export function buildCrown(): THREE.Group {
  const gold = mat('#f6c63c', 0.12)
  const shade = mat('#d99a1e', 0.08)
  const group = new THREE.Group()
  const add = (m: THREE.Material, a: [number, number, number], b: [number, number, number]): void =>
    void group.add(block(m, a, b))
  const o = 4.75 // just outside the hat layer
  const i = 3.9
  add(gold, [-o, 7.5, -o], [o, 9.5, -i])
  add(gold, [-o, 7.5, i], [o, 9.5, o])
  add(gold, [-o, 7.5, -i], [-i, 9.5, i])
  add(gold, [i, 7.5, -i], [o, 9.5, i])
  add(shade, [-o - 0.1, 7.2, -o - 0.1], [o + 0.1, 7.6, o + 0.1])
  for (const x of [-o, -0.6, o - 1.2])
    for (const z of [-o, o - 0.85]) add(x === -0.6 ? gold : shade, [x, 9.5, z], [x + 1.2, 11.5, z + 0.85])
  for (const x of [-o, o - 0.85]) add(gold, [x, 9.5, -0.6], [x + 0.85, 11.5, 0.6])
  const ruby = mat('#e0283a', 0.25)
  const sapphire = mat('#2f6bff', 0.25)
  add(ruby, [-0.6, 8, o - 0.2], [0.6, 9.1, o + 0.25])
  add(ruby, [-0.6, 8, -o - 0.25], [0.6, 9.1, -o + 0.2])
  add(sapphire, [o - 0.2, 8, -0.6], [o + 0.25, 9.1, 0.6])
  add(sapphire, [-o - 0.25, 8, -0.6], [-o + 0.2, 9.1, 0.6])
  return group
}

/** The wizard's pointed hat: a wide brim and a cone of shrinking tiers that leans back. */
function buildWizardHat(images: FabricImages): THREE.Group {
  const dark = mat('#3a1036')
  const gold = mat('#f2c14e', 0.3)
  const group = new THREE.Group()
  group.add(block(dark, [-6.5, 7.6, -6.5], [6.5, 8.6, 6.5]))
  group.add(block(gold, [-4.4, 8.6, -4.4], [4.4, 9.5, 4.4]))
  const tiers: [number, number, number, number][] = [
    [4.3, 9.5, 12, 0],
    [3.2, 12, 14.5, -0.6],
    [2.1, 14.5, 16.8, -1.4],
    [1, 16.8, 18.6, -2.4]
  ]
  for (const [r, y0, y1, z] of tiers) group.add(clothBlock(images, 'starrobe', [-r, y0, -r + z], [r, y1, r + z]))
  group.add(block(gold, [-0.6, 13, 2.5], [0.6, 14.2, 2.75]))
  group.add(block(gold, [1.2, 10.5, 4.25], [2.2, 11.5, 4.5]))
  return group
}

/** A held prop: built in item space (block units, centred like an item model), held the way tools are. */
interface HeldProp {
  object: THREE.Object3D
  display: Record<string, ItemTransform>
}
/** Vanilla's handheld.json display, which swords and sticks use. */
const HANDHELD: Record<string, ItemTransform> = {
  thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
  thirdperson_lefthand: { rotation: [0, 90, -55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] }
}

/** A long rod along the item's diagonal (where a sword's blade is), `top` built at its upper end. */
function rodProp(rod: THREE.Material, length: number, top: (g: THREE.Group, end: number) => void): HeldProp {
  const stick = new THREE.Group()
  const half = length / 2
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, length, 1.3), rod)
  m.castShadow = true
  stick.add(m)
  top(stick, half)
  // Along the diagonal from bottom left to top right, through the item's centre; pixels to blocks.
  stick.rotation.z = -Math.PI / 4
  stick.position.set(8, 8, 8)
  const item = new THREE.Group()
  item.scale.setScalar(1 / 16)
  item.add(stick)
  return { object: item, display: HANDHELD }
}
const cube = (m: THREE.Material, size: number, y: number): THREE.Mesh => {
  const c = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), m)
  c.position.y = y
  c.castShadow = true
  return c
}

function buildSceptre(): HeldProp {
  const gold = mat('#f6c63c', 0.15)
  return rodProp(gold, 20, (g, end) => {
    g.add(cube(mat('#d99a1e'), 2.4, end + 0.6))
    g.add(cube(mat('#e0283a', 0.4), 1.8, end + 2.4))
    g.add(cube(gold, 2.2, -end + 0.6))
  })
}

function buildStaff(): HeldProp {
  return rodProp(mat('#6b4423'), 26, (g, end) => {
    const gold = mat('#f2c14e', 0.2)
    for (const x of [-1.2, 1.2]) {
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.6, 0.7), gold)
      prong.position.set(x, end + 1, 0)
      g.add(prong)
    }
    g.add(cube(mat('#5fe8ff', 1.4), 2.4, end + 2.2))
  })
}

export interface BuiltOutfit {
  /** Suit layers and extras, each to be added to the named part. */
  parts: { part: PartName; object: THREE.Object3D }[]
  /** Held in the main hand when it is empty. */
  held: HeldProp | null
}

/** Builds an outfit for a player model (`slim` for Alex-style arms). */
export async function buildOutfit(id: OutfitId, slim: boolean): Promise<BuiltOutfit> {
  const art = SUITS[id]
  const images = await loadFabrics()
  const parts: BuiltOutfit['parts'] = []
  const layers: [ArmorSlot[], THREE.Texture][] = [
    [[...(art.helmet ? (['head'] as ArmorSlot[]) : []), 'chest', 'feet'], suitTexture(art.layer1, images)],
    [['legs'], suitTexture(art.layer2, images)]
  ]
  for (const [slots, tex] of layers) {
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide })
    for (const slot of slots)
      for (const { part, box } of armorBoxes(slot, slim)) {
        // Only the helmet's inner box: the outer one is for the hat layer of real armour textures.
        if (slot === 'head' && box.uv[0] === 32) continue
        const mesh = new THREE.Mesh(boxGeometry(boxFaces(box), 64, 32), m)
        mesh.castShadow = true
        parts.push({ part, object: mesh })
      }
  }
  const body = (object: THREE.Object3D): void => void parts.push({ part: 'body', object })
  let held: HeldProp | null = null
  switch (id) {
    case 'king': {
      parts.push({ part: 'head', object: buildCrown() })
      // Cloak, its gold hem and the ermine collar (the fur's black tails are in the fabric).
      body(clothBlock(images, 'velvet', [-5, -14, -3.9], [5, 0.4, -3.15], '#c8c8c8'))
      body(clothBlock(images, 'filigree', [-5.05, -14.4, -3.95], [5.05, -13.6, -3.1]))
      body(clothBlock(images, 'ermine', [-5.4, -0.8, -3.95], [5.4, 0.9, 3.15]))
      held = buildSceptre()
      break
    }
    case 'astronaut': {
      const grey = mat('#9aa4b2')
      body(clothBlock(images, 'spacesuit', [-3.8, -11, -6.2], [3.8, -0.4, -3.05]))
      body(block(grey, [-3.2, -10, -6.4], [-1.2, -4, -6.15]))
      body(block(grey, [1.2, -10, -6.4], [3.2, -4, -6.15]))
      body(block(mat('#2f80ed', 0.6), [-0.5, -3, -6.3], [0.5, -2, -6.15]))
      break
    }
    case 'soldier': {
      body(clothBlock(images, 'webbing', [-3.4, -9.5, -5.4], [3.4, -2, -3.05], '#b8b8b8'))
      body(clothBlock(images, 'leather', [-4, -2, -5.4], [4, -0.2, -3.05])) // rolled bedding
      body(block(mat('#3d4430'), [-2.6, -8, -5.7], [2.6, -4.5, -5.35]))
      break
    }
    case 'wizard': {
      parts.push({ part: 'head', object: buildWizardHat(images) })
      body(clothBlock(images, 'starrobe', [-4.8, -16, -3.7], [4.8, 0.2, -3.1], '#a0a0a0'))
      held = buildStaff()
      break
    }
  }
  return { parts, held }
}

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

export type OutfitId = 'king' | 'astronaut' | 'soldier' | 'wizard' | 'knight' | 'pirate' | 'police' | 'ninja'

export const OUTFITS: { id: OutfitId; label: string; hint: string }[] = [
  { id: 'king', label: 'King', hint: 'Crown, red velvet cloak with an ermine collar and a gold sceptre' },
  {
    id: 'astronaut',
    label: 'Astronaut',
    hint: 'Quilted white space suit, gold-visored helmet and a life-support pack'
  },
  { id: 'soldier', label: 'Soldier', hint: 'Camo uniform, combat helmet, webbing vest and a field pack' },
  { id: 'wizard', label: 'Wizard', hint: 'Pointed hat, starry robe and a staff with a glowing orb' },
  {
    id: 'knight',
    label: 'Knight',
    hint: 'Great helm with a plume, chain mail, a blue tabard with a gold cross and a sword'
  },
  { id: 'pirate', label: 'Pirate', hint: 'Tricorn hat, eyepatch, red captain’s coat, tall boots and a cutlass' },
  { id: 'police', label: 'Police', hint: 'Peaked cap with a badge, blue shirt and tie, duty belt and navy trousers' },
  { id: 'ninja', label: 'Ninja', hint: 'Black hood that shows only the eyes, red sash, wrapped shins and a katana' }
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
/** Chain mail: rows of rings, every other row shifted by one. */
const chain = (g: G, n: Record<string, Rect>): void => {
  fillNet(g, '#8d939a', n)
  g.fillStyle = '#5d636b'
  for (const [x0, y0, w, h] of Object.values(n))
    for (let y = y0; y < y0 + h; y++) for (let x = x0 + ((y - y0) % 2); x < x0 + w; x += 2) g.fillRect(x, y, 1, 1)
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
  },
  knight: {
    helmet: true,
    layer1: (g, f) => {
      // Great helm: steel with a dark eye slit and breathing holes.
      fillNet(g, '#b9bec4', HEAD)
      band(g, '#8d939a', HEAD, 7, 8)
      for (const s of SIDES) fill(g, '#9aa0a7', [HEAD[s][0], HEAD[s][1], HEAD[s][2], 1])
      fill(g, '#1b1d20', [9, 11, 6, 1]) // eye slit
      fill(g, '#d8dce0', [11, 12, 2, 4]) // nose guard
      for (const x of [9, 10, 13, 14]) fill(g, '#2a2d31', [x, 14, 1, 1])
      chain(g, BODY)
      chain(g, ARM)
      // Tabard front and back with a gold cross.
      for (const [x, y] of [
        [20, 20],
        [32, 20]
      ] as const) {
        fill(g, '#1f4fa8', [x, y, 8, 12])
        fill(g, '#f2c14e', [x + 3, y + 1, 2, 7])
        fill(g, '#f2c14e', [x + 1, y + 3, 6, 2])
      }
      band(g, f.leather, BODY, 8, 9) // sword belt
      band(g, '#b9bec4', ARM, 0, 3) // pauldrons
      band(g, '#b9bec4', ARM, 9, 12) // gauntlets
      band(g, '#b9bec4', LEG, 7, 12) // sabatons
      fill(g, '#6b7078', LEG.bottom)
    },
    layer2: (g) => {
      chain(g, BODY)
      chain(g, LEG)
      band(g, '#1f4fa8', BODY, 0, 4) // tabard skirt
      band(g, '#b9bec4', LEG, 4, 6) // knee cops
    }
  },
  pirate: {
    helmet: false,
    layer1: (g, f) => {
      // Red captain's coat, open over a white shirt, with gold buttons.
      fillNet(g, '#9b1b1f', BODY)
      fill(g, '#efe6d2', [22, 20, 4, 12])
      fill(g, '#d9cfb8', [23, 21, 2, 2]) // shirt ruffle
      for (const y of [22, 25, 28]) {
        fill(g, '#f2c14e', [21, y, 1, 1])
        fill(g, '#f2c14e', [26, y, 1, 1])
      }
      band(g, f.leather, BODY, 8, 10) // wide belt
      fill(g, '#f2c14e', [23, 28, 2, 2]) // buckle
      fillNet(g, '#9b1b1f', ARM)
      band(g, '#efe6d2', ARM, 10, 11) // shirt cuffs
      band(g, '#f2c14e', ARM, 9, 10) // braid
      band(g, f.leather, LEG, 5, 12) // tall boots
      band(g, '#3b2a1c', LEG, 5, 6) // boot tops
      fill(g, '#2a1d14', LEG.bottom)
    },
    layer2: (g, f) => {
      fillNet(g, '#9b1b1f', BODY) // coat tails
      fillNet(g, '#3c3a46', LEG) // breeches
      shade(g, BODY, 0.25)
      band(g, f.leather, BODY, 0, 1)
    }
  },
  police: {
    helmet: false,
    layer1: (g) => {
      fillNet(g, '#7fa6d6', BODY) // shirt
      fill(g, '#1c2a4a', [23, 20, 2, 7]) // tie
      fill(g, '#f2c14e', [21, 21, 1, 2]) // badge
      fill(g, '#1c2a4a', [26, 21, 1, 1]) // pocket button
      for (const s of SIDES) fill(g, '#2b4a7a', [BODY[s][0], BODY[s][1], BODY[s][2], 1]) // collar
      band(g, '#151515', BODY, 9, 11) // duty belt
      fill(g, '#c9c9c9', [23, 29, 2, 1]) // buckle
      fill(g, '#2a2a2a', [20, 30, 2, 2]) // radio pouch
      fillNet(g, '#7fa6d6', ARM)
      band(g, '#2b4a7a', ARM, 0, 2) // shoulder patches
      band(g, '#151515', LEG, 9, 12) // shoes
      fill(g, '#0d0d0d', LEG.bottom)
    },
    layer2: (g) => {
      fillNet(g, '#1c2a4a', BODY)
      fillNet(g, '#1c2a4a', LEG)
      band(g, '#151515', BODY, 0, 2)
      for (const s of ['right', 'left'] as const) fill(g, '#2f4270', [LEG[s][0] + 1, LEG[s][1], 1, 12]) // stripe
    }
  },
  ninja: {
    helmet: true,
    layer1: (g) => {
      // Hood and mask: everything but a band across the eyes, where the skin shows through.
      fillNet(g, '#17171c', HEAD)
      g.clearRect(9, 11, 6, 3)
      fill(g, '#24242b', [8, 10, 8, 1]) // brow fold
      fill(g, '#24242b', [8, 14, 8, 1]) // mask edge
      fill(g, '#b3202a', [24, 10, 8, 1]) // headband tails at the back
      fill(g, '#b3202a', [27, 11, 1, 3])
      fill(g, '#b3202a', [29, 11, 1, 2])
      fillNet(g, '#17171c', BODY)
      fill(g, '#24242b', [21, 20, 3, 5]) // wrap-over fold
      band(g, '#b3202a', BODY, 8, 10) // sash
      fillNet(g, '#17171c', ARM)
      band(g, '#3a3a42', ARM, 8, 12) // arm wraps
      band(g, '#24242b', LEG, 10, 12) // tabi
    },
    layer2: (g) => {
      fillNet(g, '#17171c', BODY)
      fillNet(g, '#17171c', LEG)
      band(g, '#b3202a', BODY, 0, 1)
      band(g, '#3a3a42', LEG, 6, 10) // shin wraps
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

function buildSword(): HeldProp {
  return rodProp(mat('#d6dbe0', 0.05), 22, (g, end) => {
    const guard = new THREE.Mesh(new THREE.BoxGeometry(7, 1.3, 1.6), mat('#f2c14e', 0.1))
    guard.position.y = -end + 5
    g.add(guard)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4.6, 1.5), mat('#4a2f1b'))
    grip.position.y = -end + 2.2
    g.add(grip)
    g.add(cube(mat('#f2c14e', 0.1), 2, -end - 0.4))
  })
}

function buildCutlass(): HeldProp {
  return rodProp(mat('#c9ced3', 0.05), 18, (g, end) => {
    const guard = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 1.6), mat('#c79a2e', 0.1)) // basket hilt
    guard.position.y = -end + 4.2
    g.add(guard)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.4, 1.5), mat('#2b1b10'))
    grip.position.y = -end + 1.6
    g.add(grip)
  })
}

function buildKatana(): HeldProp {
  return rodProp(mat('#dfe3e8', 0.08), 26, (g, end) => {
    const guard = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 3), mat('#2a2a2a'))
    guard.position.y = -end + 6.5
    g.add(guard)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6.2, 1.5), mat('#1a1a1f'))
    grip.position.y = -end + 3.1
    g.add(grip)
    for (const y of [-end + 1.2, -end + 3.1, -end + 5]) {
      const wrap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 1.7), mat('#b3202a'))
      wrap.position.y = y
      g.add(wrap)
    }
  })
}

/** A head piece made of flat boxes, given in pixels in the head's space (the head spans y 0…8, its face at +z). */
function headPiece(pieces: [THREE.Material, Vec, Vec][]): THREE.Group {
  const group = new THREE.Group()
  for (const [m, a, b] of pieces) group.add(block(m, a, b))
  return group
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
    case 'knight': {
      const red = mat('#c0262f')
      parts.push({
        part: 'head',
        object: headPiece([
          [mat('#8d939a'), [-1, 8.4, -1.5], [1, 9.6, 1.5]],
          [red, [-0.8, 9.6, -2.5], [0.8, 12, 1.5]],
          [red, [-0.7, 10, -4], [0.7, 11.6, -2.5]]
        ])
      })
      // Blue cloak from the shoulders.
      body(block(mat('#1a3f86'), [-4.6, -13, -3.8], [4.6, 0.2, -3.15]))
      held = buildSword()
      break
    }
    case 'pirate': {
      const black = mat('#18161a')
      const gold = mat('#d9a93a', 0.1)
      parts.push({
        part: 'head',
        object: headPiece([
          // Tricorn: a crown, a wide brim and three upturned sides, trimmed in gold.
          [black, [-4.4, 8, -4.4], [4.4, 10.2, 4.4]],
          [black, [-6, 8, -6], [6, 8.8, 6]],
          [black, [-6, 8.8, -6], [-4.4, 11, 4]],
          [black, [4.4, 8.8, -6], [6, 11, 4]],
          [black, [-4.4, 8.8, -6], [4.4, 11, -4.4]],
          [gold, [-6.05, 10.6, -6.05], [6.05, 11.05, 4.05]],
          [mat('#e8e2d4'), [-1, 9, 4.4], [1, 10.4, 4.6]], // skull badge
          // Eyepatch and its strap.
          [black, [1, 3.4, 4.05], [3, 5.4, 4.3]],
          [black, [-4.25, 5, -4.25], [4.25, 5.6, 4.25]]
        ])
      })
      body(block(mat('#7a1418'), [-4.6, -15, -3.8], [4.6, -6, -3.1])) // coat skirt
      held = buildCutlass()
      break
    }
    case 'police': {
      const navy = mat('#1c2a4a')
      parts.push({
        part: 'head',
        object: headPiece([
          [navy, [-4.5, 7.6, -4.5], [4.5, 9.4, 4.5]],
          [navy, [-5, 9.4, -5], [5, 10.4, 5.3]], // crown
          [mat('#121212'), [-4.6, 7.6, 4.4], [4.6, 7.9, 6.6]], // peak
          [mat('#121212'), [-4.55, 7.9, -4.55], [4.55, 8.4, 4.55]], // band
          [mat('#f2c14e', 0.2), [-0.8, 8.6, 4.5], [0.8, 10, 4.75]] // badge
        ])
      })
      break
    }
    case 'ninja': {
      // A second katana sheathed across the back.
      const scabbard = new THREE.Group()
      scabbard.add(block(mat('#141418'), [-0.8, -9, -0.6], [0.8, 9, 0.6]))
      scabbard.add(block(mat('#b3202a'), [-0.9, 9, -0.7], [0.9, 10, 0.7]))
      scabbard.add(block(mat('#1a1a1f'), [-0.7, 10, -0.5], [0.7, 14, 0.5]))
      scabbard.position.set(0, -6 * PLAYER_PIXEL, -3.8 * PLAYER_PIXEL)
      scabbard.rotation.z = Math.PI / 4
      body(scabbard)
      held = buildKatana()
      break
    }
  }
  return { parts, held }
}

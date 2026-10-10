// Custom outfits for players (not from the game): a king, an astronaut, a soldier and a wizard. The suit itself
// is painted onto the armour layout, so it bends with the joints like armour does; capes, packs, hats and the
// staffs are extra pieces on the head, the body or in the hand.
import * as THREE from 'three'
import { armorBoxes, boxFaces, PLAYER_PIXEL, type ArmorSlot, type PartName } from '@shared/minecraft/playerModel'
import type { ItemTransform } from '@shared/minecraft/items'
import { boxGeometry } from './builders'

export type OutfitId = 'king' | 'astronaut' | 'soldier' | 'wizard'

export const OUTFITS: { id: OutfitId; label: string; hint: string }[] = [
  { id: 'king', label: 'King', hint: 'Crown, red cloak with an ermine collar and a gold sceptre' },
  { id: 'astronaut', label: 'Astronaut', hint: 'White space suit, gold-visored helmet and a life-support pack' },
  { id: 'soldier', label: 'Soldier', hint: 'Camo uniform, combat helmet, vest and a field pack' },
  { id: 'wizard', label: 'Wizard', hint: 'Pointed hat, starry robe and a staff with a glowing orb' }
]

type G = CanvasRenderingContext2D
type Rect = [number, number, number, number]

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

const fill = (g: G, c: string, [x, y, w, h]: Rect): void => {
  g.fillStyle = c
  g.fillRect(x, y, w, h)
}
const fillNet = (g: G, c: string, n: Record<string, Rect>): void => {
  for (const r of Object.values(n)) fill(g, c, r)
}
/** Rows [from, to) of every side face of a box (row 0 is the top). */
const band = (g: G, c: string, n: Record<string, Rect>, from: number, to: number): void => {
  for (const s of SIDES) {
    const [x, y, w] = n[s]
    fill(g, c, [x, y + from, w, to - from])
  }
}
/** Deterministic 0…1 noise per pixel. */
const noise = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Scatters `c` over a net's pixels with the given chance. */
const speckle = (g: G, c: string, n: Record<string, Rect>, chance: number, seed: number): void => {
  g.fillStyle = c
  for (const [x0, y0, w, h] of Object.values(n))
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) if (noise(x, y, seed) < chance) g.fillRect(x, y, 1, 1)
}
/** Blotchy camouflage: blobs of each colour, a few pixels across. */
const camo = (g: G, n: Record<string, Rect>, colours: string[], seed: number): void => {
  for (const [x0, y0, w, h] of Object.values(n))
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const v = noise(Math.floor(x / 2), Math.floor(y / 2), seed) + 0.5 * noise(x, y, seed + 1)
        const i = Math.min(colours.length - 1, Math.floor((v / 1.5) * colours.length))
        g.fillStyle = colours[i]
        g.fillRect(x, y, 1, 1)
      }
}

/** The two armour-layout textures of a suit: layer 1 (helmet, body, arms, boots) and layer 2 (waist, legs). */
interface SuitArt {
  layer1: (g: G) => void
  layer2: (g: G) => void
  /** Whether layer 1 paints a helmet (otherwise the head is left bare for a hat or crown). */
  helmet: boolean
}

const SUITS: Record<OutfitId, SuitArt> = {
  king: {
    helmet: false,
    layer1: (g) => {
      fillNet(g, '#a3172a', BODY)
      fill(g, '#f2c14e', [23, 20, 2, 12]) // gold placket down the front
      band(g, '#f2c14e', BODY, 9, 10) // belt
      fill(g, '#f7e08a', [23, 29, 2, 1]) // buckle
      fillNet(g, '#a3172a', ARM)
      band(g, '#f2c14e', ARM, 10, 12) // cuffs
      band(g, '#3a1d12', LEG, 8, 12) // boots
      fill(g, '#2a140c', LEG.bottom)
    },
    layer2: (g) => {
      fillNet(g, '#5e0f1c', BODY)
      fillNet(g, '#5e0f1c', LEG)
      band(g, '#f2c14e', BODY, 0, 1)
    }
  },
  astronaut: {
    helmet: true,
    layer1: (g) => {
      fillNet(g, '#eef1f5', HEAD)
      fill(g, '#c5ccd6', [8, 8, 8, 1])
      // Gold visor across the front, with a glint.
      fill(g, '#b9862c', [9, 10, 6, 4])
      fill(g, '#e9c46a', [9, 10, 6, 1])
      fill(g, '#fff3c4', [10, 11, 1, 1])
      fill(g, '#8a5a1c', [9, 13, 6, 1])
      fillNet(g, '#eef1f5', BODY)
      band(g, '#c5ccd6', BODY, 0, 1)
      // Chest control panel.
      fill(g, '#9aa4b2', [21, 22, 4, 3])
      fill(g, '#e63946', [22, 23, 1, 1])
      fill(g, '#2f80ed', [24, 23, 1, 1])
      fill(g, '#ffd166', [23, 24, 1, 1])
      fill(g, '#2f80ed', [26, 21, 1, 2]) // flag patch
      fillNet(g, '#eef1f5', ARM)
      band(g, '#c5ccd6', ARM, 5, 6)
      band(g, '#9aa4b2', ARM, 10, 12) // gloves
      band(g, '#9aa4b2', LEG, 8, 12) // boots
      fill(g, '#6b7380', LEG.bottom)
    },
    layer2: (g) => {
      fillNet(g, '#eef1f5', BODY)
      fillNet(g, '#eef1f5', LEG)
      band(g, '#c5ccd6', LEG, 5, 6) // knee joints
      band(g, '#9aa4b2', BODY, 0, 1)
    }
  },
  soldier: {
    helmet: true,
    layer1: (g) => {
      // A combat helmet: the top and the upper rows of the head only.
      camo(g, { top: HEAD.top }, ['#4b5d2a', '#5c6e34', '#3a4721', '#6b6a3e'], 3)
      for (const s of SIDES) {
        const [x, y, w] = HEAD[s]
        camo(g, { s: [x, y, w, 3] }, ['#4b5d2a', '#5c6e34', '#3a4721', '#6b6a3e'], 4)
        fill(g, '#2f3a1a', [x, y + 3, w, 1]) // rim
      }
      fill(g, '#2b2b22', [8, 12, 1, 3]) // chin strap
      fill(g, '#2b2b22', [15, 12, 1, 3])
      camo(g, BODY, ['#556b2f', '#3b4a22', '#7a7a4a', '#2e2a1e'], 7)
      camo(g, ARM, ['#556b2f', '#3b4a22', '#7a7a4a', '#2e2a1e'], 8)
      // Vest over the chest and back, with pouches.
      fill(g, '#3d4430', [20, 20, 8, 8])
      fill(g, '#2c3122', [21, 25, 2, 2])
      fill(g, '#2c3122', [25, 25, 2, 2])
      fill(g, '#3d4430', [32, 20, 8, 8])
      band(g, '#2c3122', BODY, 8, 9) // belt
      band(g, '#1f1f1c', LEG, 8, 12) // boots
      fill(g, '#141412', LEG.bottom)
    },
    layer2: (g) => {
      camo(g, BODY, ['#556b2f', '#3b4a22', '#7a7a4a', '#2e2a1e'], 11)
      camo(g, LEG, ['#556b2f', '#3b4a22', '#7a7a4a', '#2e2a1e'], 12)
    }
  },
  wizard: {
    helmet: false,
    layer1: (g) => {
      fillNet(g, '#3b1f7a', BODY)
      speckle(g, '#f2c14e', BODY, 0.06, 21)
      band(g, '#f2c14e', BODY, 9, 10)
      fill(g, '#5b37a8', [23, 20, 2, 9]) // robe opening
      fillNet(g, '#3b1f7a', ARM)
      speckle(g, '#f2c14e', ARM, 0.05, 22)
      band(g, '#5b37a8', ARM, 9, 12) // wide cuffs
      band(g, '#3a2a1a', LEG, 9, 12) // shoes
    },
    layer2: (g) => {
      fillNet(g, '#3b1f7a', BODY)
      fillNet(g, '#3b1f7a', LEG)
      speckle(g, '#f2c14e', LEG, 0.05, 23)
    }
  }
}

function suitTexture(paint: (g: G) => void): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 32
  const g = c.getContext('2d')!
  paint(g)
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
function buildWizardHat(): THREE.Group {
  const purple = mat('#3b1f7a')
  const dark = mat('#2a145a')
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
  for (const [r, y0, y1, z] of tiers) group.add(block(purple, [-r, y0, -r + z], [r, y1, r + z]))
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
export function buildOutfit(id: OutfitId, slim: boolean): BuiltOutfit {
  const art = SUITS[id]
  const parts: BuiltOutfit['parts'] = []
  const layers: [ArmorSlot[], THREE.Texture][] = [
    [[...(art.helmet ? (['head'] as ArmorSlot[]) : []), 'chest', 'feet'], suitTexture(art.layer1)],
    [['legs'], suitTexture(art.layer2)]
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
      const red = mat('#9e1022')
      const ermine = mat('#f4f1ea')
      const spot = mat('#151515')
      body(block(red, [-5, -14, -3.9], [5, 0.4, -3.15]))
      body(block(mat('#f2c14e', 0.15), [-5.05, -14.4, -3.95], [5.05, -13.6, -3.1]))
      body(block(ermine, [-5.4, -0.8, -3.95], [5.4, 0.9, 3.15]))
      for (const [x, z] of [
        [-3.5, -3.95],
        [0, -3.95],
        [3.5, -3.95],
        [-2, 3.15],
        [2, 3.15]
      ])
        body(block(spot, [x - 0.35, -0.3, z - 0.05], [x + 0.35, 0.4, z + (z > 0 ? 0.08 : 0.05)]))
      held = buildSceptre()
      break
    }
    case 'astronaut': {
      const white = mat('#e6e9ee')
      const grey = mat('#9aa4b2')
      body(block(white, [-3.8, -11, -6.2], [3.8, -0.4, -3.05]))
      body(block(grey, [-3.2, -10, -6.4], [-1.2, -4, -6.15]))
      body(block(grey, [1.2, -10, -6.4], [3.2, -4, -6.15]))
      body(block(mat('#2f80ed', 0.6), [-0.5, -3, -6.3], [0.5, -2, -6.15]))
      break
    }
    case 'soldier': {
      body(block(mat('#4b5a2c'), [-3.4, -9.5, -5.4], [3.4, -2, -3.05]))
      body(block(mat('#6b4f2a'), [-4, -2, -5.4], [4, -0.2, -3.05]))
      body(block(mat('#3d4430'), [-2.6, -8, -5.7], [2.6, -4.5, -5.35]))
      break
    }
    case 'wizard': {
      parts.push({ part: 'head', object: buildWizardHat() })
      body(block(mat('#2a145a'), [-4.8, -16, -3.7], [4.8, 0.2, -3.1]))
      held = buildStaff()
      break
    }
  }
  return { parts, held }
}

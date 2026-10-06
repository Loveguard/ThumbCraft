import { describe, expect, it } from 'vitest'
import { generatedItemQuads, itemIcon, listItems, resolveItem } from '@shared/minecraft/items'
import { armorBoxes, boxFaces, type BoxDef } from '@shared/minecraft/playerModel'

const models: Record<string, unknown> = {
  'item/generated': {
    parent: 'builtin/generated',
    display: { thirdperson_righthand: { rotation: [0, 0, 0], translation: [0, 3, 1], scale: [0.55, 0.55, 0.55] } }
  },
  'item/handheld': {
    parent: 'item/generated',
    display: { thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] } }
  },
  'item/diamond_sword': { parent: 'minecraft:item/handheld', textures: { layer0: 'minecraft:item/diamond_sword' } },
  'item/stone': { parent: 'minecraft:block/stone' },
  'item/shield': { parent: 'builtin/entity' },
  'block/block': {
    display: {
      thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] }
    }
  },
  'block/cube_all': { parent: 'block/block', elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }] },
  'block/stone': { parent: 'block/cube_all', textures: { all: 'block/stone' } }
}

describe('item models', () => {
  it('resolves sprites and takes the nearest display transform', () => {
    const sword = resolveItem(models, 'diamond_sword')!
    expect(sword.kind).toBe('generated')
    expect(sword.kind === 'generated' && sword.layers).toEqual(['item/diamond_sword'])
    expect(sword.display.thirdperson_righthand.rotation).toEqual([0, -90, 55])
  })

  it('resolves block items to their block model and skips code-drawn items', () => {
    const stone = resolveItem(models, 'stone')!
    expect(stone.kind).toBe('model')
    expect(stone.display.thirdperson_righthand.scale).toEqual([0.375, 0.375, 0.375])
    expect(resolveItem(models, 'shield')).toBeNull()
    expect(listItems(models)).toEqual(['diamond_sword', 'stone'])
    expect(itemIcon(models, 'stone')).toBe('block/stone')
  })

  it('extrudes a sprite with a side face on every opaque/transparent edge', () => {
    // A single opaque pixel: front + back + 4 sides.
    const one = generatedItemQuads(16, 16, (x, y) => (x === 3 && y === 4 ? 255 : 0))
    expect(one).toHaveLength(6)
    // Two side-by-side pixels share an edge, so it gets no face: 2 + 6.
    const two = generatedItemQuads(16, 16, (x, y) => (y === 0 && x < 2 ? 255 : 0))
    expect(two).toHaveLength(8)
    expect(one[0].corners.every((c) => c[2] === 8.5)).toBe(true)
  })
})

describe('armor', () => {
  it('uses the outer model for chestplates and the inner one for leggings', () => {
    const chest = armorBoxes('chest', false)
    expect(chest.find((b) => b.part === 'body')!.box.inflate).toBe(1)
    expect(armorBoxes('legs', false).every((b) => b.box.inflate === 0.5)).toBe(true)
    // Arms are split at the elbow like the player's.
    expect(chest.filter((b) => b.part === 'rightForearm')).toHaveLength(1)
  })

  it('mirrors the left limbs like vanilla (texture flipped, sides swapped)', () => {
    const left = armorBoxes('feet', false).find((b) => b.part === 'leftLeg')!.box
    const right: BoxDef = { ...left, mirror: false }
    const [fl, fr] = [boxFaces(left), boxFaces(right)]
    expect(fl[0].uv).toEqual([fr[0].uv[2], fr[0].uv[1], fr[0].uv[0], fr[0].uv[3]])
    expect(fl[2].uv[0]).toBe(fr[3].uv[2])
  })
})

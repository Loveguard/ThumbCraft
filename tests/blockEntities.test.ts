import { describe, expect, it } from 'vitest'
import { blockEntityKind, blockEntityPlan, Pose, standaloneBlockEntity } from '../src/shared/minecraft/blockEntities'
import { textureCandidates } from '../src/shared/minecraft/entityModels'

const at = (m: number[], p: [number, number, number]): number[] => {
  const pose = new Pose()
  pose.m = m
  return pose.apply(p).map((v) => Math.round(v * 1000) / 1000)
}

describe('block entities', () => {
  it('knows which blocks are chests and signs', () => {
    expect(blockEntityKind('minecraft:chest')).toBe('chest')
    expect(blockEntityKind('trapped_chest')).toBe('chest')
    expect(blockEntityKind('waxed_exposed_copper_chest')).toBe('chest')
    expect(blockEntityKind('oak_sign')).toBe('sign')
    expect(blockEntityKind('dark_oak_wall_sign')).toBe('wall_sign')
    expect(blockEntityKind('cherry_hanging_sign')).toBe('hanging_sign')
    expect(blockEntityKind('bamboo_wall_hanging_sign')).toBe('wall_hanging_sign')
    expect(blockEntityKind('stone')).toBeNull()
    expect(blockEntityKind('chest_minecart')).toBeNull()
  })

  it('puts a chest upright in its block, lock on the facing side', () => {
    const south = blockEntityPlan('chest', { facing: 'south', type: 'single' })!
    // Bottom corner of the body (model pixels 1,0,1) stays at the bottom of the block.
    expect(at(south.matrix, [1, 0, 1])).toEqual([0.063, 0, 0.063])
    // The lock (model z 15…16 at the lid) faces south (+Z) for a south-facing chest.
    expect(at(south.matrix, [8, 9, 16])[2]).toBeCloseTo(1)
    const north = blockEntityPlan('chest', { facing: 'north', type: 'single' })!
    expect(at(north.matrix, [8, 9, 16])[2]).toBeCloseTo(0)
    const east = blockEntityPlan('chest', { facing: 'east', type: 'single' })!
    expect(at(east.matrix, [8, 9, 16])[0]).toBeCloseTo(1)
    expect(south.textures[0]).toBe('entity/chest/normal')
  })

  it('uses the halves and textures of double chests', () => {
    const left = blockEntityPlan('trapped_chest', { facing: 'north', type: 'left' })!
    expect(left.layers[0]).toBe('minecraft:double_chest_left#main')
    expect(left.textures[0]).toBe('entity/chest/trapped_left')
    expect(blockEntityPlan('ender_chest', { facing: 'north' })!.textures[0]).toBe('entity/chest/ender')
  })

  it('stands a sign on the ground and hangs a wall sign on the wall', () => {
    const sign = blockEntityPlan('oak_sign', { rotation: '0' })!
    // The stick's foot (model y 12, pixels Y down) touches the ground; the board's top is at 1.083 blocks.
    expect(at(sign.matrix, [0, 12, 0])).toEqual([0.5, 0, 0.5])
    expect(at(sign.matrix, [0, -14, 0])[1]).toBeCloseTo(1.083, 2)
    expect(sign.layers).toContain('minecraft:sign/standing/oak#main')
    expect(sign.textures[0]).toBe('entity/signs/oak')
    const wall = blockEntityPlan('spruce_wall_sign', { facing: 'south' })!
    // A south-facing wall sign hangs against the north side of its block, facing south.
    expect(at(wall.matrix, [0, -8, 0])[2]).toBeCloseTo(0.0625, 2)
  })

  it('stands Mobs-tab chests and signs on the origin', () => {
    const chest = standaloneBlockEntity('minecraft:chest#main')!
    expect(at(chest, [1, 0, 1])).toEqual([-0.437, 0, -0.437])
    const sign = standaloneBlockEntity('minecraft:sign/standing/oak#main')!
    expect(at(sign, [0, 12, 0])).toEqual([0, 0, 0])
    expect(standaloneBlockEntity('minecraft:zombie#main')).toBeNull()
  })

  it('finds sign textures in the signs folder', () => {
    const layer = {
      texture: [64, 32] as [number, number],
      root: { pivot: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], visible: true, quads: [], children: {} } as never
    }
    const sizes = { 'entity/signs/oak': [64, 32], 'entity/signs/birch': [64, 32] } as Record<string, [number, number]>
    expect(textureCandidates('minecraft:sign/standing/oak#main', layer, sizes)[0]).toBe('entity/signs/oak')
  })
})

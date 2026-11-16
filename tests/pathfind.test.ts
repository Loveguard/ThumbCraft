import { describe, expect, it } from 'vitest'
import {
  avoidObstacles,
  blockedBetween,
  blockKind,
  findRoute,
  legsOf,
  simplify,
  standingCell,
  type Block,
  type Grid
} from '@shared/pathfind'

/** A world from a function: the ground at y=-1 (solid) up to `height(x, z)` blocks, plus extras. */
function world(
  height: (x: number, z: number) => number,
  extra: (x: number, y: number, z: number) => Block | null = () => null
): Grid {
  return {
    at: (x, y, z) => {
      const e = extra(x, y, z)
      if (e) return e
      return y < height(x, z) ? 'solid' : 'air'
    }
  }
}

const flat = world(() => 0)

describe('findRoute', () => {
  it('walks straight across open ground', () => {
    const r = findRoute(flat, [0, 0, 0], [6, 0, 0])
    expect(r.reached).toBe(true)
    expect(r.steps.at(-1)).toMatchObject({ x: 6, y: 0, z: 0 })
    expect(r.steps.every((s) => s.move === 'walk')).toBe(true)
    expect(r.steps.length).toBe(7)
  })

  it('climbs steps one block at a time and walks off a short drop', () => {
    const stairs = world((x) => (x < 0 ? 0 : Math.min(3, Math.floor(x / 2) + 1)))
    const up = findRoute(stairs, [-2, 0, 0], [8, 3, 0])
    expect(up.reached).toBe(true)
    expect(up.steps.at(-1)!.y).toBe(3)
    const down = findRoute(stairs, [8, 3, 0], [-2, 0, 0])
    expect(down.reached).toBe(true)
  })

  it('goes round a wall instead of through it', () => {
    const wall = world(
      () => 0,
      (x, y, z) => (x === 3 && z >= -3 && z <= 3 && y >= 0 && y <= 3 ? 'solid' : null)
    )
    const r = findRoute(wall, [0, 0, 0], [6, 0, 0])
    expect(r.reached).toBe(true)
    expect(r.steps.some((s) => Math.abs(s.z) >= 4)).toBe(true)
    expect(r.steps.every((s) => !(s.x === 3 && Math.abs(s.z) <= 3))).toBe(true)
  })

  it("doesn't cut a corner it can't fit through", () => {
    const corner = world(
      () => 0,
      (x, y, z) => (((x === 1 && z === 0) || (x === 0 && z === 1)) && y >= 0 && y <= 2 ? 'solid' : null)
    )
    const r = findRoute(corner, [0, 0, 0], [1, 0, 1])
    expect(r.reached).toBe(true)
    // The straight diagonal goes between the two blocks; it has to go round.
    expect(r.steps.length).toBeGreaterThan(2)
  })

  it('swims across a pool', () => {
    const pool = world(
      (x, z) => (x >= 2 && x <= 7 && z >= -3 && z <= 3 ? -2 : 0),
      (x, y, z) => (x >= 2 && x <= 7 && z >= -3 && z <= 3 && y >= -2 && y < 0 ? 'water' : null)
    )
    // The long way round is long: through the water is cheaper than a detour of 8.
    const r = findRoute(pool, [0, 0, 0], [9, 0, 0], { margin: 3 })
    expect(r.reached).toBe(true)
    expect(r.steps.some((s) => s.move === 'swim')).toBe(true)
  })

  it('climbs a ladder up a wall', () => {
    const tower = world(
      (x) => (x >= 2 ? 6 : 0),
      (x, y, z) => (x === 1 && z === 0 && y >= 0 && y < 6 ? 'climb' : null)
    )
    const r = findRoute(tower, [-1, 0, 0], [4, 6, 0])
    expect(r.reached).toBe(true)
    expect(r.steps.filter((s) => s.move === 'climb').length).toBeGreaterThanOrEqual(5)
    expect(r.steps.at(-1)).toMatchObject({ x: 4, y: 6 })
  })

  it('leaps a gap that is too wide to step over', () => {
    // A trench three blocks wide and deep, across the whole way.
    const trench = world((x) => (x >= 3 && x <= 5 ? -20 : 0))
    const r = findRoute(trench, [0, 0, 0], [8, 0, 0])
    expect(r.reached).toBe(true)
    expect(r.steps.some((s) => s.move === 'leap')).toBe(true)
    const legs = legsOf(r.steps)
    expect(legs.map((l) => l.move)).toEqual(['walk', 'leap', 'walk'])
  })

  it('goes as near as it can when there is no way', () => {
    // An island: the goal is a platform across a trench wider than any jump.
    const island = world((x) => (x >= 3 && x <= 14 ? -20 : 0))
    const r = findRoute(island, [0, 0, 0], [16, 0, 0], { margin: 2, drop: 3 })
    expect(r.reached).toBe(false)
    expect(r.steps.at(-1)!.x).toBeLessThanOrEqual(2)
    expect(r.steps.at(-1)!.x).toBeGreaterThanOrEqual(1)
  })

  it('stays out of lava', () => {
    const lava = world(
      () => 0,
      (x, y, z) => (x >= 2 && x <= 3 && z >= -8 && z <= 8 && y === 0 ? 'lava' : null)
    )
    const r = findRoute(lava, [0, 0, 0], [6, 0, 0])
    expect(r.steps.every((s) => !(s.x >= 2 && s.x <= 3 && Math.abs(s.z) <= 8 && s.y === 0 && s.move !== 'leap'))).toBe(
      true
    )
  })
})

describe('legsOf', () => {
  it('drops points on straight lines but keeps the turns', () => {
    const r = findRoute(flat, [0, 0, 0], [4, 0, 4])
    const legs = legsOf(r.steps)
    expect(legs).toHaveLength(1)
    expect(legs[0].points.length).toBe(2)
    expect(
      simplify([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [2, 0, 1]
      ]).length
    ).toBe(3)
  })
})

describe('blockKind', () => {
  it('tells blocks from plants, water, ladders and lava', () => {
    expect(blockKind('minecraft:stone')).toBe('solid')
    expect(blockKind('minecraft:oak_leaves')).toBe('solid')
    expect(blockKind('minecraft:mushroom_stem')).toBe('solid')
    expect(blockKind('minecraft:short_grass')).toBe('air')
    expect(blockKind('minecraft:poppy')).toBe('air')
    expect(blockKind('minecraft:oak_door')).toBe('air')
    expect(blockKind('minecraft:oak_wall_sign')).toBe('air')
    expect(blockKind('minecraft:water')).toBe('water')
    expect(blockKind('minecraft:kelp')).toBe('water')
    expect(blockKind('minecraft:ladder')).toBe('climb')
    expect(blockKind('minecraft:lava')).toBe('lava')
    expect(blockKind('minecraft:cactus')).toBe('hurt')
    expect(blockKind('minecraft:oak_slab', { waterlogged: 'true' })).toBe('solid')
  })
})

describe('standingCell', () => {
  it('finds ground under a point, and a neighbour for a point on an edge', () => {
    expect(standingCell(flat, [2.5, 0, 3.5])).toEqual([2, 0, 3])
    expect(standingCell(flat, [2.5, 0.99, 3.5])).toEqual([2, 1, 3].map((v, i) => (i === 1 ? 0 : v)))
    const pillar = world((x, z) => (x === 0 && z === 0 ? 3 : 0))
    expect(standingCell(pillar, [0.5, 3, 0.5])).toEqual([0, 3, 0])
  })
})

describe('avoidObstacles', () => {
  const wall = world(
    () => 0,
    (x, y, z) => (x === 3 && z >= -3 && z <= 3 && y >= 0 && y <= 3 ? 'solid' : null)
  )
  it('goes round a wall across the way, to the same end point', () => {
    const out = avoidObstacles(wall, [
      [0.5, 0, 0.5],
      [6.5, 0, 0.5]
    ])
    expect(out.length).toBeGreaterThan(2)
    expect(out.at(-1)).toEqual([6.5, 0, 0.5])
    for (let i = 1; i < out.length; i++) expect(blockedBetween(wall, out[i - 1], out[i])).toBe(false)
  })

  it('leaves a clear path, and a step up of one block, alone', () => {
    const p: [number, number, number][] = [
      [0.5, 0, 0.5],
      [6.5, 0, 4.5]
    ]
    expect(avoidObstacles(flat, p)).toEqual(p)
    const step = world((x) => (x >= 3 ? 1 : 0))
    const q: [number, number, number][] = [
      [0.5, 0, 0.5],
      [6.5, 1, 0.5]
    ]
    expect(avoidObstacles(step, q)).toEqual(q)
  })

  it('walks into a trunk only if there is no way round', () => {
    const trunk = world(
      () => 0,
      (x, y, z) => (x === 3 && z === 0 && y >= 0 && y <= 6 ? 'solid' : null)
    )
    expect(blockedBetween(trunk, [0.5, 0, 0.5], [6.5, 0, 0.5])).toBe(true)
    expect(blockedBetween(trunk, [0.5, 0, 3.5], [6.5, 0, 3.5])).toBe(false)
  })
})

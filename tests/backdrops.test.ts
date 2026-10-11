import { describe, expect, it } from 'vitest'
import { BACKDROP_GROUND, BACKDROPS, buildBackdrop } from '@shared/minecraft/backdrops'

describe('instant backdrops', () => {
  for (const { id } of BACKDROPS) {
    it(`${id}: flat clear stage at ground level, same every time`, () => {
      const t = buildBackdrop(id)
      const at = (x: number, y: number, z: number): string =>
        t.palette[t.blocks[x + z * t.sizeX + y * t.sizeX * t.sizeZ]].name
      const c = t.sizeX / 2
      // Solid ground at BACKDROP_GROUND under the centre, open air (or a thin snow layer) above it. The
      // ravine's centre is the gap itself, with lava far below.
      if (id === 'ravine') expect(at(c, 2, c)).toBe('minecraft:lava')
      else expect(at(c, BACKDROP_GROUND, c)).not.toBe('minecraft:air')
      expect(['minecraft:air', 'minecraft:snow']).toContain(at(c, BACKDROP_GROUND + 1, c))
      expect(at(c, BACKDROP_GROUND + 2, c)).toBe('minecraft:air')
      expect(t.blocks.length).toBe(t.sizeX * t.sizeY * t.sizeZ)
      expect(t.palette.every((b) => /^minecraft:[a-z_]+$/.test(b.name))).toBe(true)
      expect(buildBackdrop(id).blocks).toEqual(t.blocks)
    })
  }
})

describe('scene props', async () => {
  const { buildTower, TOWER_TOP } = await import('@shared/minecraft/backdrops')
  it('the tower has a floor to stand on at TOWER_TOP', () => {
    const t = buildTower()
    const at = (x: number, y: number, z: number): string =>
      t.palette[t.blocks[x + z * t.sizeX + y * t.sizeX * t.sizeZ]].name
    expect(at(3, TOWER_TOP - 1, 3)).toMatch(/stone_bricks/)
    expect(at(3, TOWER_TOP, 3)).toBe('minecraft:air') // room to stand on the floor
    expect(t.blocks.length).toBe(t.sizeX * t.sizeY * t.sizeZ)
  })
})

describe('quick props', async () => {
  const { buildEndPortal, buildEnchantingSetup, buildStarterHouse } = await import('@shared/minecraft/props')
  const count = (t: ReturnType<typeof buildEndPortal>, name: string): number =>
    Array.from(t.blocks).filter((i) => t.palette[i].name === `minecraft:${name}`).length
  it('the end portal is a full ring of twelve eyed frames round nine portal blocks', () => {
    const t = buildEndPortal()
    expect(count(t, 'end_portal_frame')).toBe(12)
    expect(count(t, 'end_portal')).toBe(9)
    expect(
      t.palette.filter((b) => b.name === 'minecraft:end_portal_frame').every((b) => b.properties.eye === 'true')
    ).toBe(true)
  })
  it('the enchanting setup has at least the fifteen bookshelves for top-level enchants', () => {
    const t = buildEnchantingSetup()
    expect(count(t, 'enchanting_table')).toBe(1)
    expect(count(t, 'bookshelf')).toBeGreaterThanOrEqual(15)
  })
  it('the starter house has a two-part door and a stair roof', () => {
    const t = buildStarterHouse()
    expect(count(t, 'oak_door')).toBe(2)
    expect(count(t, 'spruce_stairs')).toBeGreaterThan(0)
  })
})

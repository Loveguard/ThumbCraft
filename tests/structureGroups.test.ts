import { describe, expect, it } from 'vitest'
import { groupStructures } from '../src/renderer/src/structureGroups'

describe('structure groups', () => {
  it('folds numbered variants into one piece and drops the folder name from labels', () => {
    const g = groupStructures([
      'village/plains/houses/plains_small_house_2',
      'village/plains/houses/plains_small_house_10',
      'village/plains/houses/plains_small_house_1',
      'village/plains/houses/plains_library_1'
    ])
    expect(g).toEqual([
      {
        label: 'Houses',
        kinds: [
          { label: 'Library', ids: ['village/plains/houses/plains_library_1'] },
          {
            label: 'Small house',
            ids: [
              'village/plains/houses/plains_small_house_1',
              'village/plains/houses/plains_small_house_2',
              'village/plains/houses/plains_small_house_10'
            ]
          }
        ]
      }
    ])
  })

  it('sections mixed results by the folders that differ', () => {
    const g = groupStructures([
      'village/plains/houses/plains_temple_3',
      'village/plains/zombie/houses/plains_temple_3',
      'village/plains/streets/straight_01'
    ])
    expect(g.map((s) => s.label)).toEqual(['Houses', 'Streets', 'Zombie · Houses'])
    expect(g[1].kinds[0].label).toBe('Straight')
  })
})

describe('structure categories', async () => {
  const { structureCategories } = await import('../src/renderer/src/structureGroups')
  it('sorts pieces into families and leaves out entity spawns and path tiles', () => {
    const c = structureCategories([
      'village/plains/houses/plains_small_house_1',
      'village/plains/villagers/nitwit',
      'village/plains/streets/straight_01',
      'village/common/animals/cows_1',
      'shipwreck/rightsideup_full',
      'fossil/spine_1',
      'nether_fossils/fossil_1',
      'mystery/thing'
    ])
    expect(c.map((x) => [x.id, x.ids.length])).toEqual([
      ['village', 1],
      ['shipwreck', 1],
      ['fossil', 2],
      ['other', 1]
    ])
  })
})

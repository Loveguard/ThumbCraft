import { describe, expect, it } from 'vitest'
import { groupParticles } from '../src/renderer/src/particleGroups'

describe('particle groups', () => {
  it('folds frames and sorts particles into categories', () => {
    const g = groupParticles([
      'particle/explosion_10',
      'particle/explosion_2',
      'particle/flame',
      'particle/heart',
      'particle/sga_b',
      'particle/sga_a',
      'particle/mystery',
      'block/stone'
    ])
    expect(g.map((c) => c.label)).toEqual(['Fire & smoke', 'Hearts & reactions', 'Magic', 'Other'])
    expect(g[0].particles.find((p) => p.name === 'explosion')!.frames).toEqual([
      'particle/explosion_2',
      'particle/explosion_10'
    ])
    expect(g[2].particles[0]).toMatchObject({
      label: 'Enchanting glyphs',
      frames: ['particle/sga_a', 'particle/sga_b']
    })
  })
})

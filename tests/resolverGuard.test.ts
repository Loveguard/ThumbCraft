import { describe, expect, it } from 'vitest'
import { ModelResolver } from '@shared/minecraft/blockModel'

describe('model resolver', () => {
  it('skips a block it cannot read instead of failing the whole build', () => {
    const r = new ModelResolver(
      { odd: { variants: { '': null } }, stone: { variants: { '': { model: 'block/stone' } } } },
      {
        'block/stone': { parent: 'block/missing_parent_loop', textures: {} },
        'block/missing_parent_loop': { parent: 'block/stone' }
      }
    )
    expect(r.variantsFor({ name: 'minecraft:odd', properties: {} })).toEqual([])
    expect(r.failed.has('odd')).toBe(true)
    // A model the baker chokes on comes back empty rather than throwing.
    expect(() => r.variantsFor({ name: 'minecraft:stone', properties: {} }).map((v) => r.bake(v))).not.toThrow()
  })
})

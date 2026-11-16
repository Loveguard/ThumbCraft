import { describe, expect, it } from 'vitest'
import { checkObjects } from '../src/renderer/src/projectObjects'

const has = { terrain: (id: string) => id === 't1', media: (id: string) => id === 'm1' }
const base = { visible: true, position: [1, 2, 3], rotation: [0, 90, 0], scale: 1 }

describe('objects of a project file', () => {
  it('passes good objects through untouched', () => {
    const text = {
      ...base,
      id: 'a',
      name: 'Title',
      kind: 'text',
      text: 'HI',
      color: '#fff',
      outlineColor: '#000',
      outlineWidth: 10,
      font: 'Anton',
      shadow: false,
      onTop: true,
      glow: '#ff0'
    }
    const r = checkObjects([text], has)
    expect(r).toMatchObject({ dropped: 0, repaired: 0 })
    expect(r.objects[0]).toEqual(text)
  })

  it('fills in what is missing or of the wrong kind', () => {
    const r = checkObjects(
      [
        { kind: 'text', id: 'a', position: [0, 'x', 0], scale: 0 },
        { ...base, kind: 'player', id: 'a', name: 'Steve', skinUrl: '', pose: { head: [10, 0, 0], body: 'bent' } }
      ],
      has
    )
    expect(r).toMatchObject({ dropped: 0, repaired: 2 })
    const [text, player] = r.objects as unknown as Record<string, unknown>[]
    expect(text).toMatchObject({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, visible: true, text: '' })
    expect(player.id).not.toBe('a') // two objects never share an id
    expect(player.pose).toMatchObject({ head: [10, 0, 0], body: [0, 0, 0], rightForearm: [0, 0, 0] })
  })

  it('leaves out what cannot be drawn', () => {
    const r = checkObjects(
      [
        null,
        'text',
        { ...base, id: 'x', name: 'x', kind: 'hologram' },
        { ...base, id: 'g', name: 'gone', kind: 'terrain', terrainId: 't9' },
        { ...base, id: 'm', name: 'model', kind: 'model', mediaId: 'm9', extraMediaIds: [] },
        { ...base, id: 'z', name: 'zombie', kind: 'mob', layer: 'minecraft:zombie#main' },
        { ...base, id: 'k', name: 'kept', kind: 'terrain', terrainId: 't1' }
      ],
      has
    )
    expect(r.dropped).toBe(6)
    expect(r.objects.map((o) => o.id)).toEqual(['k'])
  })
})

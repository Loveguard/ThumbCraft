import { beforeEach, describe, expect, it } from 'vitest'
import { selection, useStore, type SceneObject } from '../src/renderer/src/store'

const title = (id: string, x: number): SceneObject => ({
  id,
  kind: 'pixelText',
  name: id,
  visible: true,
  position: [x, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  text: id,
  color: '#ffffff',
  depth: 1,
  shadow: false
})

const state = (): ReturnType<typeof useStore.getState> => useStore.getState()
const ids = (): string[] => selection(state())

describe('multi-selection and groups', () => {
  beforeEach(() => {
    useStore.setState({
      objects: [title('a', 0), title('b', 2), title('c', 4), title('d', 6)],
      past: [],
      future: [],
      selectedId: null,
      selectedIds: []
    })
  })

  it('adds and removes objects with Ctrl+click', () => {
    state().select('a')
    state().toggleSelect('c')
    expect(ids()).toEqual(['a', 'c'])
    expect(state().selectedId).toBe('c')
    state().toggleSelect('a')
    expect(ids()).toEqual(['c'])
  })

  it('groups the selection, keeps members together and selects them as one', () => {
    state().setSelection(['a', 'c'])
    state().groupSelected()
    const objs = state().objects
    const g = objs.find((o) => o.id === 'a')!.groupId
    expect(g).toBeTruthy()
    expect(objs.find((o) => o.id === 'c')!.groupId).toBe(g)
    // Members sit next to each other where the topmost one was.
    expect(objs.map((o) => o.id)).toEqual(['b', 'a', 'c', 'd'])
    state().select(null)
    state().select('a')
    expect(ids().sort()).toEqual(['a', 'c'])
    // A single member can still be picked on its own.
    state().selectOnly('c')
    expect(ids()).toEqual(['c'])
  })

  it('moves a selection as one undo step and ungroups', () => {
    state().setSelection(['b', 'd'])
    state().updateMany([
      { id: 'b', patch: { position: [2, 5, 0] } },
      { id: 'd', patch: { position: [6, 5, 0] } }
    ])
    expect(state().past).toHaveLength(1)
    state().undo()
    expect(state().objects.find((o) => o.id === 'd')!.position).toEqual([6, 0, 0])
    state().groupSelected()
    state().ungroupSelected()
    expect(state().objects.every((o) => !o.groupId)).toBe(true)
  })

  it('duplicates and deletes the whole selection', () => {
    state().setSelection(['a', 'b'])
    state().groupSelected()
    state().duplicateSelected()
    const copies = state().objects.filter((o) => o.name.endsWith('copy'))
    expect(copies).toHaveLength(2)
    // The copies form their own group.
    expect(copies[0].groupId).toBe(copies[1].groupId)
    expect(copies[0].groupId).not.toBe(state().objects.find((o) => o.id === 'a')!.groupId)
    expect(ids()).toEqual(copies.map((c) => c.id))
    state().removeSelected()
    expect(state().objects).toHaveLength(4)
    expect(ids()).toEqual([])
  })
})

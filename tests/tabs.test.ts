import { beforeEach, describe, expect, it } from 'vitest'
import { NO_EFFECTS, terrainStore, useStore, type SceneObject } from '../src/renderer/src/store'
import {
  activeTabIsBlank,
  addTab,
  closeTab,
  duplicateTab,
  switchTab,
  tabProject,
  useTabs
} from '../src/renderer/src/tabs'

const text = (id: string): SceneObject => ({
  id,
  kind: 'pixelText',
  name: id,
  visible: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  text: id,
  color: '#ffffff',
  depth: 1,
  shadow: false
})

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const names = (): string[] => st().objects.map((o) => o.name)

describe('project tabs', () => {
  beforeEach(() => {
    const key = useTabs.getState().active
    useTabs.setState({ tabs: [{ key, snap: null }], active: key })
    useStore.setState({
      objects: [text('day 1')],
      past: [],
      future: [],
      effects: { ...NO_EFFECTS, look: 'teal-orange' },
      project: { id: 'p1', name: 'Day 1', path: '/a.bfproj', dirty: false, createdAt: 0 }
    })
  })

  it('a new tab starts empty and switching back restores the first project exactly', () => {
    const first = useTabs.getState().active
    addTab()
    expect(names()).toEqual([])
    expect(activeTabIsBlank()).toBe(true)
    expect(st().effects.look).toBe(NO_EFFECTS.look)
    st().add(text('day 100'))
    const second = useTabs.getState().active
    switchTab(first)
    expect(names()).toEqual(['day 1'])
    expect(st().effects.look).toBe('teal-orange')
    expect(st().project.name).toBe('Day 1')
    switchTab(second)
    expect(names()).toEqual(['day 100'])
    // Undo history travels with its tab.
    st().undo()
    expect(names()).toEqual([])
  })

  it('duplicating makes an unsaved, independent copy', () => {
    duplicateTab()
    expect(names()).toEqual(['day 1'])
    expect(st().project.name).toBe('Day 1 (2)')
    expect(st().project.path).toBeNull()
    expect(st().project.id).not.toBe('p1')
    st().add(text('extra'))
    const copy = useTabs.getState().active
    const original = useTabs.getState().tabs.find((t) => t.key !== copy)!
    expect(original.snap!.objects.map((o) => o.name)).toEqual(['day 1'])
    expect(tabProject(original).name).toBe('Day 1')
  })

  it('closing the tab on screen shows its neighbour and frees terrain nobody uses', () => {
    terrainStore.set('t-gone', {} as never)
    addTab()
    st().add({ ...text('ground'), kind: 'terrain', terrainId: 't-gone' } as unknown as SceneObject)
    closeTab(useTabs.getState().active)
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(names()).toEqual(['day 1'])
    expect(terrainStore.has('t-gone')).toBe(false)
    // The last tab can't be closed.
    closeTab(useTabs.getState().active)
    expect(useTabs.getState().tabs).toHaveLength(1)
  })
})

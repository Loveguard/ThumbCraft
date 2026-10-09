import { beforeEach, describe, expect, it } from 'vitest'
import { freshShots, inShot, NO_EFFECTS, useStore, type SceneObject } from '../src/renderer/src/store'

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
const visible = (): string[] =>
  st()
    .objects.filter((o) => inShot(o, st().activeShot))
    .map((o) => o.name)

describe('shots (A/B/C variants)', () => {
  beforeEach(() => {
    useStore.setState({
      objects: [text('world'), text('title')],
      past: [],
      future: [],
      selectedId: null,
      selectedIds: [],
      effects: { ...NO_EFFECTS },
      ...freshShots()
    })
  })

  it('starts with one shot that shows everything', () => {
    expect(st().shots).toHaveLength(1)
    expect(visible()).toEqual(['world', 'title'])
  })

  it('copies layers into a new shot by default, independent of the original', () => {
    const a = st().activeShot
    st().addShot({})
    const b = st().activeShot
    expect(b).not.toBe(a)
    expect(visible()).toEqual(['world', 'title'])
    // Editing B's copy leaves A's original alone.
    const bTitle = st().objects.find((o) => o.name === 'title' && inShot(o, b))!
    st().update(bTitle.id, { name: 'title B' })
    st().switchShot(a)
    expect(visible()).toEqual(['world', 'title'])
    st().switchShot(b)
    expect(visible()).toEqual(['world', 'title B'])
  })

  it('links or leaves out layers on request', () => {
    st().addShot({ world: 'link', title: 'skip' })
    expect(visible()).toEqual(['world'])
    expect(st().objects.find((o) => o.id === 'world')!.shots).toHaveLength(2)
    // New layers go into the current shot only.
    st().add(text('new title'))
    const [a] = st().shots
    st().switchShot(a.id)
    expect(visible()).toEqual(['world', 'title'])
  })

  it('stops at three shots and removes from one shot only while a layer is in several', () => {
    st().addShot({ world: 'link', title: 'link' })
    st().addShot({ world: 'link', title: 'link' })
    st().addShot({})
    expect(st().shots).toHaveLength(3)
    st().remove('title')
    expect(visible()).toEqual(['world'])
    expect(st().objects.find((o) => o.id === 'title')!.shots).toHaveLength(2)
    // A layer can't be taken out of its last shot.
    st().setInShot('title', st().shots[0].id, false)
    st().setInShot('title', st().shots[1].id, false)
    expect(st().objects.find((o) => o.id === 'title')!.shots).toHaveLength(1)
  })

  it('deletes a shot with the layers only it had, and undo brings both back', () => {
    st().addShot({ world: 'link', title: 'skip' })
    st().add(text('B only'))
    const b = st().activeShot
    st().removeShot(b)
    expect(st().shots).toHaveLength(1)
    expect(st().objects.map((o) => o.name)).toEqual(['world', 'title'])
    st().undo()
    expect(st().shots).toHaveLength(2)
    expect(st().activeShot).toBe(b)
    expect(visible()).toEqual(['world', 'B only'])
  })

  it('keeps an own look per shot when asked', () => {
    const a = st().activeShot
    st().addShot({})
    st().setShotOwnLook(true)
    st().setEffects({ vignette: true })
    st().switchShot(a)
    expect(st().effects.vignette).toBe(false)
    st().switchShot(st().shots[1].id)
    expect(st().effects.vignette).toBe(true)
  })
})

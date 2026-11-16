import { beforeEach, describe, expect, it } from 'vitest'
import { cameraBridge, useStore, type CameraState, type SceneObject } from '../src/renderer/src/store'

let view: CameraState = { position: [0, 0, 10], target: [0, 0, 0] }
cameraBridge.get = () => structuredClone(view)
cameraBridge.set = (c) => void (view = structuredClone(c))

const move = (position: [number, number, number], startedAt: number): void => {
  const before = cameraBridge.get!()!
  view = { ...view, position }
  useStore.getState().recordCamera(before, startedAt)
}

describe('undo history', () => {
  beforeEach(() => {
    view = { position: [0, 0, 10], target: [0, 0, 0] }
    useStore.setState({ objects: [], past: [], future: [], selectedId: null })
  })

  it('undoes a camera move back to where the view started', () => {
    move([0, 5, 20], Date.now())
    // A zoom straight after the orbit belongs to the same step.
    move([0, 5, 30], Date.now())
    expect(useStore.getState().past).toHaveLength(1)
    useStore.getState().undo()
    expect(view.position).toEqual([0, 0, 10])
    useStore.getState().redo()
    expect(view.position).toEqual([0, 5, 30])
  })

  it('interleaves camera moves with scene edits', () => {
    useStore.getState().add({ id: 'a', kind: 'text' } as unknown as SceneObject)
    move([3, 3, 3], 0)
    useStore.getState().undo()
    expect(view.position).toEqual([0, 0, 10])
    expect(useStore.getState().objects).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().objects).toHaveLength(0)
    useStore.getState().redo()
    useStore.getState().redo()
    expect(useStore.getState().objects).toHaveLength(1)
    expect(view.position).toEqual([3, 3, 3])
  })

  it('ignores clicks that did not move the camera', () => {
    useStore.getState().recordCamera(cameraBridge.get!()!, Date.now())
    expect(useStore.getState().past).toHaveLength(0)
  })
})

describe('undo for the look of the scene', () => {
  beforeEach(() => {
    useStore.setState({ objects: [], past: [], future: [], selectedId: null })
    useStore.getState().undo() // forgets the last commit, so steps from other tests never merge with these
  })

  it('undoes an effect change and a slider drag as one step', () => {
    const s = useStore.getState()
    const before = s.effects.bloomIntensity
    s.setEffects({ bloomIntensity: 1.1 })
    useStore.getState().setEffects({ bloomIntensity: 1.4 })
    expect(useStore.getState().past).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().effects.bloomIntensity).toBe(before)
    useStore.getState().redo()
    expect(useStore.getState().effects.bloomIntensity).toBe(1.4)
  })

  it('treats a sky preset and the sun it moves as one step', () => {
    const s = useStore.getState()
    const sun = s.settings.sunElevation
    s.setSky({ preset: 'sunset' })
    useStore.getState().setSettings({ sunElevation: 2 })
    expect(useStore.getState().past).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().sky.preset).toBe('biome')
    expect(useStore.getState().settings.sunElevation).toBe(sun)
  })

  it('leaves workspace settings alone', () => {
    const s = useStore.getState()
    s.setSettings({ showGrid: !s.settings.showGrid })
    expect(useStore.getState().past).toHaveLength(0)
    const grid = useStore.getState().settings.showGrid
    useStore.getState().setSettings({ fog: !s.settings.fog })
    useStore.getState().setSettings({ exportWidth: 1920 })
    useStore.getState().undo()
    expect(useStore.getState().settings.fog).toBe(s.settings.fog)
    expect(useStore.getState().settings.showGrid).toBe(grid)
    expect(useStore.getState().settings.exportWidth).toBe(1920)
  })
})

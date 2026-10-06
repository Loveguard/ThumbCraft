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

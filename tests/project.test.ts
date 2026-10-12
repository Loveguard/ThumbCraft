import { beforeEach, describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { MAX_MEDIA, mediaStore, registerFile, registerMedia } from '../src/renderer/src/media'
import { loadProject, serializeProject } from '../src/renderer/src/project'
import { openProjectFile } from '../src/renderer/src/projectActions'
import { NO_EFFECTS, terrainStore, useStore, type SceneObject } from '../src/renderer/src/store'
import { useTabs } from '../src/renderer/src/tabs'

const base = { visible: true, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } as const

function scene(): void {
  const media = registerMedia('photo.png', 'image/png', new Uint8Array([137, 80, 78, 71, 1, 2, 3]), 'media-1')
  terrainStore.set('t1', {
    sizeX: 2,
    sizeY: 1,
    sizeZ: 2,
    originX: 0,
    originY: 64,
    originZ: 0,
    palette: [{ name: 'minecraft:stone', properties: {} }],
    blocks: new Uint16Array([0, 0, 0, 0]),
    biomePalette: ['minecraft:plains'],
    biomes: new Uint16Array([0, 0, 0, 0]),
    dimension: 'overworld'
  })
  const objects: SceneObject[] = [
    { ...base, id: 'o1', name: 'ground', kind: 'terrain', terrainId: 't1' },
    {
      ...base,
      id: 'o2',
      name: 'photo',
      kind: 'image',
      url: media.url,
      mediaId: media.id,
      aspect: 1,
      opacity: 1,
      onTop: false
    }
  ] as SceneObject[]
  useStore.setState({
    objects,
    past: [],
    future: [],
    effects: { ...NO_EFFECTS },
    project: { id: 'p1', name: 'Day 1', path: null, dirty: false, createdAt: 0 }
  })
}

/** Rewrites the "unpacked size" a zip claims for one entry (central directory and local header). */
function claimSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice()
  const dv = new DataView(out.buffer)
  const nameBytes = new TextEncoder().encode(name)
  for (let i = 0; i < out.length - 4; i++) {
    const sig = dv.getUint32(i, true)
    const [nameAt, sizeAt] = sig === 0x02014b50 ? [46, 24] : sig === 0x04034b50 ? [30, 22] : [0, 0]
    if (!nameAt || dv.getUint16(i + nameAt - (sig === 0x02014b50 ? 18 : 4), true) !== nameBytes.length) continue
    if (nameBytes.every((b, j) => out[i + nameAt + j] === b)) dv.setUint32(i + sizeAt, size, true)
  }
  return out
}

describe('project files', () => {
  beforeEach(() => {
    mediaStore.clear()
    terrainStore.clear()
  })

  it('round-trips terrain and media', () => {
    scene()
    const bytes = serializeProject()
    mediaStore.clear()
    terrainStore.clear()
    useStore.setState({ objects: [] })

    const opened = loadProject(bytes, '/a.bfproj')
    expect(opened.name).toBe('Day 1')
    expect(useStore.getState().objects.map((o) => o.name)).toEqual(['ground', 'photo'])
    expect([...terrainStore.get('t1')!.blocks]).toEqual([0, 0, 0, 0])
    expect([...mediaStore.get('media-1')!.bytes]).toEqual([137, 80, 78, 71, 1, 2, 3])
    const photo = useStore.getState().objects[1] as SceneObject & { url: string }
    expect(photo.url).toBe(mediaStore.get('media-1')!.url)
  })

  it('stores media uncompressed', () => {
    scene()
    const raw = serializeProject()
    // Stored entries hold the file's bytes as they are.
    const at = raw.findIndex((_, i) => [137, 80, 78, 71, 1, 2, 3].every((b, j) => raw[i + j] === b))
    expect(at).toBeGreaterThan(0)
    expect(unzipSync(raw)['media/media-1']).toBeDefined()
  })

  it('refuses a project holding a file bigger than the limit, and never touches the scene', () => {
    scene()
    const bad = claimSize(serializeProject(), 'media/media-1', MAX_MEDIA + 1)
    useStore.setState({ objects: [] })
    expect(() => loadProject(bad, null)).toThrow(/too large or damaged/)
    expect(useStore.getState().objects).toEqual([])
  })

  it('refuses outside URLs in a project', () => {
    const json = {
      format: 'blockframe-project',
      version: 1,
      id: 'x',
      name: 'x',
      createdAt: 0,
      savedAt: 0,
      minecraftVersion: null,
      objects: [{ ...base, id: 'o', name: 'o', kind: 'image', url: 'file:///C:/secret.png', aspect: 1, opacity: 1 }],
      settings: {},
      effects: {},
      sky: {},
      camera: null,
      terrains: [],
      media: []
    }
    loadProject(zipSync({ 'project.json': new TextEncoder().encode(JSON.stringify(json)) }), null)
    expect((useStore.getState().objects[0] as SceneObject & { url: string }).url).toBe('')
  })

  it('refuses to import a file a project could not hold', async () => {
    const huge = { name: 'clip.mp4', type: 'video/mp4', size: MAX_MEDIA + 1, arrayBuffer: () => Promise.reject() }
    expect(await registerFile(huge as unknown as File)).toBeNull()
    expect(useStore.getState().status).toMatch(/clip\.mp4.*256 MB/)
  })

  it('gives a reopened copy of an open project its own id', async () => {
    scene()
    const copy = serializeProject() // same id as the project on screen ("p1")
    ;(globalThis as { window?: unknown }).window = {
      blockframe: {
        openProject: async () => ({ bytes: copy, path: '/original.bfproj' }),
        autosaveProject: async () => undefined
      }
    }
    const key = useTabs.getState().active
    useTabs.setState({ tabs: [{ key, snap: null }], active: key })
    useStore.setState({ project: { ...useStore.getState().project, path: '/renamed.bfproj' } })
    await openProjectFile()
    const { tabs } = useTabs.getState()
    expect(tabs).toHaveLength(2)
    expect(useStore.getState().project.id).not.toBe('p1')
    expect(tabs[0].snap?.project.id).toBe('p1')
  })
})

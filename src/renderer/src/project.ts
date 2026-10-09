// ThumbCraft project files (.bfproj): a zip with the scene description plus the binary data it needs
// (terrain voxels and the user's imported media), so a project opens identically on any machine.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import * as THREE from 'three'
import { fullPose } from '@shared/minecraft/playerModel'
import type { TerrainData } from '@shared/types'
import { viewport } from './components/Viewport'
import { backgroundScenes, mediaIdsOf, mediaStore, pruneMedia, registerMedia } from './media'
import { defaultSkinUrl } from './minecraft/builders'
import {
  DEFAULT_SETTINGS,
  DEFAULT_SKY,
  NO_EFFECTS,
  newProjectInfo,
  terrainStore,
  useStore,
  type EffectSettings,
  type SceneObject,
  type SceneSettings,
  type SkySettings
} from './store'

export const PROJECT_FORMAT = 'blockframe-project'
export const PROJECT_VERSION = 1

interface TerrainMeta extends Omit<TerrainData, 'blocks' | 'biomes'> {
  id: string
}

interface ProjectJson {
  format: typeof PROJECT_FORMAT
  version: number
  id: string
  name: string
  createdAt: number
  savedAt: number
  minecraftVersion: string | null
  objects: SceneObject[]
  settings: SceneSettings
  effects: EffectSettings
  sky: SkySettings
  camera: { position: number[]; target: number[] } | null
  terrains: TerrainMeta[]
  media: { id: string; name: string; mime: string }[]
}

const bytesOf = (a: Uint16Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
const u16 = (b: Uint8Array): Uint16Array => new Uint16Array(b.slice().buffer)

/** Serialises the current scene. Only terrains and media still referenced by objects are included. */
export function serializeProject(): Uint8Array {
  const s = useStore.getState()
  const files: Record<string, Uint8Array> = {}

  // Blob URLs are session-only; strip them (they are rebuilt from the embedded bytes on open).
  const objects = s.objects.map((o) =>
    (o.kind === 'image' || o.kind === 'video') && o.mediaId ? { ...o, url: '' } : o
  )

  const terrainIds = new Set(s.objects.flatMap((o) => (o.kind === 'terrain' ? [o.terrainId] : [])))
  const terrains: TerrainMeta[] = []
  for (const id of terrainIds) {
    const t = terrainStore.get(id)
    if (!t) continue
    const { blocks, biomes, ...meta } = t
    terrains.push({ id, ...meta })
    files[`terrain/${id}/blocks.u16`] = bytesOf(blocks)
    files[`terrain/${id}/biomes.u16`] = bytesOf(biomes)
  }

  const mediaIds = new Set<string>()
  for (const o of s.objects) mediaIdsOf(o, mediaIds)
  if (s.sky.preset === 'hdri' && s.sky.hdriMediaId) mediaIds.add(s.sky.hdriMediaId)
  if (s.effects.look === 'custom' && s.effects.lutMediaId) mediaIds.add(s.effects.lutMediaId)
  const media = []
  for (const id of mediaIds) {
    const m = mediaStore.get(id)
    if (!m) continue
    media.push({ id, name: m.name, mime: m.mime })
    files[`media/${id}`] = m.bytes
  }

  const cam = viewport.camera
  const target = viewport.controls?.target
  const json: ProjectJson = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: s.project.id,
    name: s.project.name,
    createdAt: s.project.createdAt,
    savedAt: Date.now(),
    minecraftVersion: s.assets?.version ?? null,
    objects,
    settings: s.settings,
    effects: s.effects,
    sky: s.sky,
    camera: cam && target ? { position: cam.position.toArray(), target: target.toArray() } : null,
    terrains,
    media
  }
  files['project.json'] = strToU8(JSON.stringify(json))
  // Terrain and media are already dense/compressed; level 1 keeps saves fast.
  return zipSync(files, { level: 1 })
}

export interface OpenedProject {
  name: string
  minecraftVersion: string | null
}

/** Biggest single file a project may contain once unpacked, and the whole project. */
const MAX_ENTRY = 256 * 2 ** 20
const MAX_TOTAL = 768 * 2 ** 20
const ENTRY = /^(project\.json|terrain\/[^/]+\/(blocks|biomes)\.u16|media\/[^/]+)$/

/** Opens the zip and checks project.json, without touching the current scene (a bad file changes nothing). */
function readProjectFile(bytes: Uint8Array): { json: ProjectJson; files: Record<string, Uint8Array> } {
  let total = 0
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (!ENTRY.test(f.name)) return false
      total += f.originalSize
      // Sizes are read before unpacking (and memory is reserved for them), so a tiny file claiming huge
      // contents is refused up front; real data never compresses better than about 1000:1.
      if (f.originalSize > MAX_ENTRY || total > MAX_TOTAL || f.originalSize > f.size * 1100 + 4096)
        throw new Error('This project file is too large or damaged')
      return true
    }
  })
  const raw = files['project.json']
  if (!raw) throw new Error('Not a ThumbCraft project (project.json missing)')
  const json = JSON.parse(strFromU8(raw)) as ProjectJson
  if (json?.format !== PROJECT_FORMAT) throw new Error('Not a ThumbCraft project')
  if (json.version > PROJECT_VERSION)
    throw new Error('This project was saved by a newer version of ThumbCraft. Update the app to open it.')
  const list = (v: unknown): boolean => Array.isArray(v)
  if (!list(json.objects) || !list(json.terrains) || !list(json.media) || typeof json.settings !== 'object')
    throw new Error('This project file is damaged (missing scene data)')
  for (const t of json.terrains) {
    const cells = t.sizeX * t.sizeY * t.sizeZ
    const blocks = files[`terrain/${t.id}/blocks.u16`]
    const biomes = files[`terrain/${t.id}/biomes.u16`]
    if (
      !Number.isInteger(cells) ||
      cells <= 0 ||
      (blocks && blocks.length !== cells * 2) ||
      (biomes && biomes.length !== t.sizeX * t.sizeZ * 2)
    )
      throw new Error('This project file is damaged (terrain size does not match its blocks)')
  }
  return { json, files }
}

/** Only media the project carries itself; a URL pointing elsewhere (a local or network file) is never loaded. */
const safeMediaUrl = (url: unknown): string => (typeof url === 'string' && /^(blob:|data:image\/)/.test(url) ? url : '')
/** Skins: the project's own image data or a texture from the game jar, nothing from the user's disk. */
const safeSkinUrl = (url: unknown, slim: boolean): string =>
  typeof url === 'string' && /^(data:image\/|mcasset:\/\/)/.test(url) ? url : defaultSkinUrl(slim)

/** Replaces the current scene with a project file's contents. */
export function loadProject(bytes: Uint8Array, path: string | null): OpenedProject {
  const { json, files } = readProjectFile(bytes)

  for (const t of json.terrains) {
    const { id, ...meta } = t
    const blocks = files[`terrain/${id}/blocks.u16`]
    const biomes = files[`terrain/${id}/biomes.u16`]
    if (!blocks || !biomes) continue
    terrainStore.set(id, { ...meta, blocks: u16(blocks), biomes: u16(biomes) })
  }

  for (const m of json.media) {
    const b = files[`media/${m.id}`]
    if (b) registerMedia(m.name, m.mime, b, m.id)
  }
  const objects = json.objects.map((o) =>
    o.kind === 'image' || o.kind === 'video'
      ? { ...o, url: o.mediaId ? (mediaStore.get(o.mediaId)?.url ?? '') : safeMediaUrl(o.url) }
      : o.kind === 'player'
        ? { ...o, pose: fullPose(o.pose), skinUrl: safeSkinUrl(o.skinUrl, o.slim) } // older projects have no elbows/knees
        : o
  )

  const { skyColor: legacySkyColor, ...settings } = json.settings as SceneSettings & { skyColor?: string | null }
  // The Vivid render mode became Painterly, which became Cartoon.
  if (['vivid', 'painterly'].includes(settings.renderMode as string)) settings.renderMode = 'cartoon'
  useStore.setState({
    objects,
    selectedId: null,
    selectedIds: [],
    selectedJoint: null,
    past: [],
    future: [],
    // Merge with defaults so projects saved before a setting existed still open.
    settings: { ...DEFAULT_SETTINGS, ...settings },
    effects: { ...NO_EFFECTS, ...json.effects },
    sky: {
      ...DEFAULT_SKY,
      ...json.sky,
      // Older projects kept a custom sky colour in settings.skyColor.
      ...(legacySkyColor && (json.sky?.preset ?? 'biome') === 'biome' ? { preset: 'color', color: legacySkyColor } : {})
    },
    project: { id: json.id, name: json.name, path, dirty: false, createdAt: json.createdAt }
  })

  if (json.camera) {
    // Wait a frame so the viewport exists (e.g. when opening from the start screen).
    requestAnimationFrame(() => {
      const cam = viewport.camera
      const controls = viewport.controls
      if (!cam || !controls || !json.camera) return
      cam.position.fromArray(json.camera.position)
      controls.target.copy(new THREE.Vector3().fromArray(json.camera.target))
      controls.update()
    })
  }
  releaseUnused()
  return { name: json.name, minecraftVersion: json.minecraftVersion }
}

export function newProject(): void {
  const { showGrid, snap, exportWidth, exportHeight, exportFormat } = useStore.getState().settings
  useStore.setState({
    // Scene look starts fresh; the user's own workspace preferences carry over.
    settings: { ...DEFAULT_SETTINGS, showGrid, snap, exportWidth, exportHeight, exportFormat },
    objects: [],
    selectedId: null,
    selectedIds: [],
    selectedJoint: null,
    past: [],
    future: [],
    effects: { ...NO_EFFECTS },
    sky: { ...DEFAULT_SKY },
    project: newProjectInfo()
  })
  releaseUnused()
}

/**
 * Frees terrain and media that no open project (tab) uses any more, including their undo histories: after the scene
 * on screen was replaced or a tab was closed.
 */
export function releaseUnused(): void {
  const used = new Set<string>()
  for (const scene of [useStore.getState(), ...backgroundScenes.get()])
    for (const list of [scene.objects, ...[...scene.past, ...scene.future].map((e) => e.objects ?? [])])
      for (const o of list) if (o.kind === 'terrain') used.add(o.terrainId)
  for (const id of [...terrainStore.keys()]) if (!used.has(id)) terrainStore.delete(id)
  pruneMedia()
}

/** A small preview image for the recent-projects list. */
export function projectThumbnail(): string | null {
  try {
    return viewport.capture?.(384, 216) ?? null
  } catch {
    return null
  }
}

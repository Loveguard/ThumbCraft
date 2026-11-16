// The window's link to the Rust side of the Tauri build (src-tauri). It provides the same `window.blockframe` API
// the Electron preload did, so the rest of the interface is unchanged. Files travel as raw bytes (not JSON
// arrays), and a few pure conversions that already live in shared/ (schematics, structures, mob names) run here.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { BlockFrameApi, ProjectMeta } from '@shared/api'
import { CLAUDE_TOOLS } from '@shared/claudeTools'
import { namesFromMappings } from '@shared/minecraft/entityModels'
import { gunzipCapped } from '@shared/minecraft/inflate'
import { parseNbt } from '@shared/minecraft/nbt'
import { readSchematic, structureToTerrain } from '@shared/minecraft/schematics'
import type { GenerateProgress, TerrainData } from '@shared/types'

/** Running inside the Tauri shell (not a plain browser or Electron). */
export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window

const windows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/**
 * Address of a file served by the app's own protocols: `mcasset` (textures from the loaded jar) and `tcres`
 * (bundled files). Windows' WebView2 reaches custom protocols as http://<scheme>.localhost.
 */
export const appUrl = (scheme: 'mcasset' | 'tcres', path: string): string =>
  windows ? `http://${scheme}.localhost/${path}` : `${scheme}://localhost/${path}`

/** Splits a packed answer from Rust: u32 length, JSON header, then raw bytes. */
function unpack<T = Record<string, unknown>>(buf: ArrayBuffer): { meta: T; bytes: Uint8Array } {
  const len = new DataView(buf).getUint32(0, true)
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as T
  return { meta, bytes: new Uint8Array(buf, 4 + len) }
}

/** An empty answer means "cancelled" for commands that open a dialog. */
const orNull = (buf: ArrayBuffer | null): ArrayBuffer | null => (buf && buf.byteLength ? buf : null)

/** Terrain in the binary form src-tauri/src/anvil.rs writes. */
function terrain(buf: ArrayBuffer): TerrainData {
  const { meta, bytes } = unpack<Omit<TerrainData, 'blocks' | 'biomes'>>(buf)
  const blocks = meta.sizeX * meta.sizeY * meta.sizeZ
  const columns = meta.sizeX * meta.sizeZ
  // Copied out, since the bytes may not start on an even offset.
  const copy = bytes.slice(0, (blocks + columns) * 2)
  const all = new Uint16Array(copy.buffer, 0, blocks + columns)
  return { ...meta, blocks: all.slice(0, blocks), biomes: all.slice(blocks) }
}

/** Sends bytes with a small JSON header (headers must be plain ASCII, hence the encoding). */
const withBytes = <T>(cmd: string, bytes: Uint8Array, meta: unknown): Promise<T> =>
  invoke<T>(cmd, bytes, { headers: { 'x-meta': encodeURIComponent(JSON.stringify(meta)) } })

/** Subscribes to a Rust event; returns an unsubscribe function right away (like the Electron preload did). */
function on<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | null = null
  let stopped = false
  void listen<T>(event, (e) => cb(e.payload)).then((un) => {
    if (stopped) un()
    else stop = un
  })
  return () => {
    stopped = true
    stop?.()
  }
}

const api: BlockFrameApi = {
  loadNewest: () => invoke('mc_load_newest'),
  pickJar: () => invoke('mc_pick_jar'),
  pickWorldFolder: () => invoke('mc_pick_world'),
  loadJar: (path) => invoke('mc_load_jar', { path }),
  findJava: () => invoke('mc_find_java'),
  installJava: () => invoke('java_install'),
  onJavaProgress: (cb) => on<string>('java:progress', cb),
  downloadClient: () => invoke('mc_download_client'),
  onClientProgress: (cb) => on<string>('mc:clientProgress', cb),
  fetchSkin: (username) => invoke('skin_fetch', { username }),
  generateTerrain: async (req) => terrain(await invoke<ArrayBuffer>('terrain_generate', { req })),
  cancelGeneration: () => invoke('terrain_cancel'),
  prefetchBiome: (version, dimension, biome, size) => invoke('terrain_prefetch', { version, dimension, biome, size }),
  prewarmGenerator: (version, biomes, size) => invoke('terrain_prewarm', { version, biomes, size }),
  importWorld: async (req) => terrain(await invoke<ArrayBuffer>('terrain_import', { req })),
  onGenerateProgress: (cb) => on<GenerateProgress>('terrain:progress', cb),
  savePng: (dataUrl, name) => invoke('file_save_png', { dataUrl, name }),
  savePsd: (bytes, name) => withBytes('file_save_psd', bytes, { name }),
  chooseVideoFile: (name, ext) => invoke('file_choose_video', { name, ext }),
  writeVideo: (bytes) => withBytes('file_write_video', bytes, {}),
  saveDataFile: (bytes, name, kind) => withBytes('file_save_data', bytes, { name, kind }),
  openDataFile: async (kind) => {
    const buf = orNull(await invoke<ArrayBuffer>('file_open_data', { kind }))
    if (!buf) return null
    const { meta, bytes } = unpack<{ name: string }>(buf)
    return { name: meta.name, bytes }
  },
  savePngs: (images) => invoke('file_save_pngs', { images }),
  eulaAccepted: () => invoke('mc_eula_accepted'),
  acceptEula: () => invoke('mc_accept_eula'),
  loadStructure: async (id) => {
    const bytes = new Uint8Array(await invoke<ArrayBuffer>('structure_load', { id }))
    return structureToTerrain(parseNbt(gunzipCapped(bytes)))
  },
  importSchematic: async () => {
    const buf = orNull(await invoke<ArrayBuffer>('schematic_import'))
    if (!buf) return null
    const { meta, bytes } = unpack<{ name: string }>(buf)
    return { name: meta.name, terrain: readSchematic(bytes, meta.name) }
  },
  loadMobModels: async () => {
    // Obfuscated versions need Mojang's names for the model classes; the list is made here from the mappings.
    const mappings = await invoke<string | null>('mobs_mappings')
    return invoke('mobs_load', { names: mappings ? namesFromMappings(mappings) : null })
  },
  onMobProgress: (cb) => on<string>('mobs:progress', cb),
  saveProject: (bytes, path, meta: ProjectMeta) => withBytes('project_save', bytes, { path, meta }),
  autosaveProject: (bytes, meta) => withBytes('project_autosave', bytes, { meta }),
  openProject: async () => {
    const buf = orNull(await invoke<ArrayBuffer>('project_open'))
    if (!buf) return null
    const { meta, bytes } = unpack<{ path: string }>(buf)
    return { bytes, path: meta.path }
  },
  recentProjects: () => invoke('project_recent'),
  openRecent: async (id) => {
    const { meta, bytes } = unpack<{ path: string | null }>(await invoke<ArrayBuffer>('project_open_recent', { id }))
    return { bytes, path: meta.path }
  },
  forgetRecent: (id) => invoke('project_forget', { id }),
  onUpdate: (cb) => on<{ version: string; ready: boolean; url: string }>('app:update', cb),
  listResourcePacks: () => invoke('packs_list'),
  addResourcePacks: (folder) => invoke('packs_add', { folder }),
  setResourcePacks: (list) => invoke('packs_set', { list }),
  listSystemFonts: () => invoke('fonts_list'),
  readSystemFont: async (path, index) => new Uint8Array(await invoke<ArrayBuffer>('fonts_read', { path, index })),
  onClaudeRequest: (cb) =>
    on<{ id: number; method: string; params: Record<string, unknown> }>('claude:request', (r) => {
      void cb(r.method, r.params ?? {}).then(
        (result) => invoke('claude_response', { id: r.id, ok: true, result: result ?? null }),
        (e: unknown) =>
          invoke('claude_response', { id: r.id, ok: false, error: e instanceof Error ? e.message : String(e) })
      )
    }),
  onFlushRequest: (cb) => on('app:flush', () => void cb().finally(() => invoke('app_flushed')))
}

if (isTauri()) {
  window.blockframe = api
  // Claude's tool list lives in shared/claudeTools.ts; the Rust bridge serves it.
  void invoke('claude_register_tools', { tools: CLAUDE_TOOLS })
  // Tells the shell the interface appeared (otherwise it explains how to recover after 20 seconds).
  const root = document.getElementById('root')
  const ready = (): boolean => {
    if (!root?.childElementCount) return false
    void invoke('app_ready')
    return true
  }
  if (root && !ready()) {
    const watch = new MutationObserver(() => ready() && watch.disconnect())
    watch.observe(root, { childList: true })
  }
}

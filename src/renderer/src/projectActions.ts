// Save / open / autosave wiring between the scene and the project files on disk.
import { pruneMedia } from './media'
import type { ProjectMeta } from '@shared/api'
import { loadProject, newProject, projectThumbnail, serializeProject } from './project'
import { useStore } from './store'
import { errorText } from './errors'

function meta(withThumbnail: boolean): ProjectMeta {
  const s = useStore.getState()
  return {
    id: s.project.id,
    name: s.project.name,
    minecraftVersion: s.assets?.version ?? null,
    savedPath: s.project.path,
    thumbnail: withThumbnail ? projectThumbnail() : null
  }
}

const report = (e: unknown): void => useStore.getState().setStatus(errorText(e))

export async function saveProject(saveAs = false): Promise<void> {
  try {
    const s = useStore.getState()
    const path = await window.blockframe.saveProject(serializeProject(), saveAs ? null : s.project.path, meta(true))
    if (!path) return
    const fileName = path
      .split(/[\\/]/)
      .pop()!
      .replace(/\.bfproj$/i, '')
    const renamed = (saveAs || !s.project.path) && fileName !== s.project.name
    useStore.getState().setProject({ path, name: renamed ? fileName : s.project.name })
    // A first save names the project after its file; write again so the file and recent list agree.
    if (renamed) await window.blockframe.saveProject(serializeProject(), path, meta(false))
    markClean()
    useStore.getState().setStatus(`Saved ${path}`)
  } catch (e) {
    report(e)
  }
}

/** Nothing to save right now (just saved, opened or started fresh). */
export function markClean(): void {
  autosaveDirty = false
  useStore.getState().setProject({ dirty: false })
}

function afterOpen(opened: { name: string; minecraftVersion: string | null }): void {
  const loaded = useStore.getState().assets?.version
  markClean()
  useStore
    .getState()
    .setStatus(
      opened.minecraftVersion && loaded && opened.minecraftVersion !== loaded
        ? `Opened “${opened.name}” — it was made with Minecraft ${opened.minecraftVersion}; blocks are now drawn with ${loaded}.`
        : `Opened “${opened.name}”`
    )
}

export async function openProjectFile(): Promise<void> {
  try {
    const r = await window.blockframe.openProject()
    if (r) afterOpen(loadProject(r.bytes, r.path))
  } catch (e) {
    report(e)
  }
}

export async function openRecentProject(id: string): Promise<void> {
  try {
    const r = await window.blockframe.openRecent(id)
    afterOpen(loadProject(r.bytes, r.path))
  } catch (e) {
    report(e)
  }
}

export function startNewProject(): void {
  void flushAutosave().finally(() => {
    newProject()
    markClean()
  })
}

// ------------------------------------------------------------------ autosave

let autosaveDirty = false
let lastChange = 0
let saving: Promise<void> | null = null

/** Writes the recovery copy now if anything changed. */
export function flushAutosave(): Promise<void> {
  const s = useStore.getState()
  pruneMedia()
  if (!autosaveDirty || s.objects.length === 0) return Promise.resolve()
  saving ??= (async () => {
    autosaveDirty = false
    try {
      await window.blockframe.autosaveProject(serializeProject(), meta(true))
    } catch (e) {
      autosaveDirty = true
      console.error('Autosave failed', e)
    }
  })().finally(() => (saving = null))
  return saving
}

/** Tracks edits and keeps a recovery copy so quitting halfway never loses work. */
export function startAutosave(): () => void {
  const unsub = useStore.subscribe((s, prev) => {
    const changed =
      s.objects !== prev.objects ||
      s.settings !== prev.settings ||
      s.effects !== prev.effects ||
      s.sky !== prev.sky ||
      s.project.name !== prev.project.name
    if (!changed) return
    autosaveDirty = true
    lastChange = Date.now()
    if (!s.project.dirty) useStore.getState().setProject({ dirty: true })
  })
  // Save a few seconds after the last edit, and at least every 30 s while editing continuously.
  let lastSave = Date.now()
  const timer = window.setInterval(() => {
    const now = Date.now()
    if (autosaveDirty && (now - lastChange > 3000 || now - lastSave > 30000)) {
      lastSave = now
      void flushAutosave()
    }
  }, 1000)
  // The main process asks for a final save when the window closes.
  const offFlush = window.blockframe.onFlushRequest(() => flushAutosave())
  return () => {
    unsub()
    clearInterval(timer)
    offFlush()
  }
}

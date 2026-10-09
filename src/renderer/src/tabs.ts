// Several projects open at once, one per tab. The project on screen lives in the main store as always; the others
// wait here as snapshots of their scene, history and camera. Terrain voxels and media are shared by id (they're
// never changed in place), so switching tabs only swaps references; nothing is copied or re-read from disk.
import { create } from 'zustand'
import { backgroundScenes } from './media'
import { releaseUnused } from './project'
import {
  cameraBridge,
  DEFAULT_SETTINGS,
  DEFAULT_SKY,
  newId,
  newProjectInfo,
  NO_EFFECTS,
  useStore,
  type CameraState
} from './store'

type Main = ReturnType<typeof useStore.getState>

/** Everything that makes up one open project. */
export type TabSnapshot = Pick<Main, 'objects' | 'settings' | 'effects' | 'sky' | 'project' | 'past' | 'future'> & {
  camera: CameraState | null
}

export interface Tab {
  /** Stable for the session (a tab keeps its key when the project in it is replaced or renamed). */
  key: string
  /** The project waiting in the background; null for the tab on screen. */
  snap: TabSnapshot | null
}

interface TabState {
  tabs: Tab[]
  active: string
}

const firstKey = newId('tab')
export const useTabs = create<TabState>(() => ({ tabs: [{ key: firstKey, snap: null }], active: firstKey }))

// Background tabs keep their images, videos and HDRIs loaded.
backgroundScenes.get = () => useTabs.getState().tabs.flatMap((t) => (t.snap ? [t.snap] : []))

function snapshot(): TabSnapshot {
  const s = useStore.getState()
  return {
    objects: s.objects,
    settings: s.settings,
    effects: s.effects,
    sky: s.sky,
    project: s.project,
    past: s.past,
    future: s.future,
    camera: cameraBridge.get?.() ?? null
  }
}

function restore(snap: TabSnapshot): void {
  const { camera, ...rest } = snap
  useStore.setState({ ...rest, selectedId: null, selectedIds: [], selectedJoint: null })
  if (camera) cameraBridge.set?.(camera)
}

/** The project info a tab shows (its name and whether it has unsaved changes). */
export const tabProject = (t: Tab): Main['project'] => t.snap?.project ?? useStore.getState().project

/** Shows another tab's project; the one on screen waits in the background exactly as it was. */
export function switchTab(key: string): void {
  const { tabs, active } = useTabs.getState()
  const to = tabs.find((t) => t.key === key)
  if (!to?.snap || key === active) return
  const snap = to.snap
  useTabs.setState({
    tabs: tabs.map((t) => (t.key === active ? { ...t, snap: snapshot() } : t.key === key ? { ...t, snap: null } : t)),
    active: key
  })
  restore(snap)
}

/**
 * Opens a new tab after the current one and shows it. `from` fills it (a copy of a project, for a variant);
 * without it the tab starts as an empty project, on the start screen.
 */
export function addTab(from?: TabSnapshot): string {
  const { tabs, active } = useTabs.getState()
  const key = newId('tab')
  const at = tabs.findIndex((t) => t.key === active) + 1
  const next = tabs.map((t) => (t.key === active ? { ...t, snap: snapshot() } : t))
  next.splice(at, 0, { key, snap: null })
  useTabs.setState({ tabs: next, active: key })
  const { showGrid, snap, exportWidth, exportHeight, exportFormat } = useStore.getState().settings
  // A new project's look starts fresh; workspace preferences carry over.
  restore(
    from ?? {
      objects: [],
      past: [],
      future: [],
      settings: { ...DEFAULT_SETTINGS, showGrid, snap, exportWidth, exportHeight, exportFormat },
      effects: { ...NO_EFFECTS },
      sky: { ...DEFAULT_SKY },
      project: newProjectInfo(),
      camera: null
    }
  )
  return key
}

/** A copy of the project on screen in a new tab: an unsaved variant to change without touching the original. */
export function duplicateTab(): void {
  const snap = snapshot()
  const name = snap.project.name.replace(/ \(\d+\)$/, '')
  const taken = new Set(useTabs.getState().tabs.map((t) => tabProject(t).name))
  let i = 2
  while (taken.has(`${name} (${i})`)) i++
  addTab({
    ...snap,
    past: [],
    future: [],
    project: { ...newProjectInfo(), name: `${name} (${i})`, dirty: true }
  })
}

/** Closes a tab (never the last one). Closing the tab on screen shows its neighbour. */
export function closeTab(key: string): void {
  const { tabs, active } = useTabs.getState()
  if (tabs.length < 2) return
  const i = tabs.findIndex((t) => t.key === key)
  if (i < 0) return
  if (key === active) {
    const next = tabs[i + 1] ?? tabs[i - 1]
    switchTab(next.key)
  }
  useTabs.setState((s) => ({ tabs: s.tabs.filter((t) => t.key !== key) }))
  releaseUnused()
}

/** The tab already showing the project with this id or file, if any. */
export function findTab(match: { id?: string; path?: string }): string | null {
  for (const t of useTabs.getState().tabs) {
    const p = tabProject(t)
    if ((match.id && p.id === match.id) || (match.path && p.path === match.path)) return t.key
  }
  return null
}

/** Whether the tab on screen is an untouched new project (so opening a file can use it instead of a new tab). */
export function activeTabIsBlank(): boolean {
  const s = useStore.getState()
  return s.objects.length === 0 && !s.project.path && !s.project.dirty
}

/** Moves a tab to another position (drag to reorder). */
export function moveTab(key: string, to: number): void {
  useTabs.setState((s) => {
    const tabs = s.tabs.filter((t) => t.key !== key)
    const tab = s.tabs.find((t) => t.key === key)
    if (!tab) return s
    tabs.splice(Math.max(0, Math.min(tabs.length, to)), 0, tab)
    return { tabs }
  })
}

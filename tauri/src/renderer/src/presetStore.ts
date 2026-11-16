// The presets you saved from the timeline, kept on this computer, and the files they are shared in.
import { create } from 'zustand'
import { cleanPreset, packFromBytes, packToBytes, type Preset } from '@shared/presets'

const KEY = 'thumbcraft.presets'

function load(): Preset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.flatMap((p) => cleanPreset(p) ?? []) : []
  } catch {
    return []
  }
}

function save(presets: Preset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets))
  } catch {
    /* private window or full: the presets last until the app closes */
  }
}

export const usePresets = create<{ presets: Preset[] }>(() => ({ presets: load() }))

const put = (presets: Preset[]): void => {
  save(presets)
  usePresets.setState({ presets })
}

export const addPreset = (p: Preset): void => put([...usePresets.getState().presets, p])
export const removePreset = (id: string): void => put(usePresets.getState().presets.filter((p) => p.id !== id))
export const renamePreset = (id: string, name: string): void =>
  put(usePresets.getState().presets.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 80) || p.name } : p)))

/** Saves all presets (or the one) as a pack file to share. Returns the path, or null when cancelled. */
export async function exportPresets(only?: string): Promise<string | null> {
  const list = usePresets.getState().presets.filter((p) => !only || p.id === only)
  if (!list.length) return null
  const name = only ? list[0].name : 'My presets'
  return window.blockframe.saveDataFile(packToBytes(name, list), name.replace(/[\\/:*?"<>|]+/g, '-'), 'presets')
}

/** Adds the presets of a pack file. Returns how many came in (new ids are made for ones already here). */
export async function importPresets(): Promise<number | null> {
  const file = await window.blockframe.openDataFile('presets')
  if (!file) return null
  const { presets } = packFromBytes(file.bytes)
  const have = new Set(usePresets.getState().presets.map((p) => p.id))
  put([
    ...usePresets.getState().presets,
    ...presets.map((p) => (have.has(p.id) ? { ...p, id: crypto.randomUUID() } : p))
  ])
  return presets.length
}

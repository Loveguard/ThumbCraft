import { create } from 'zustand'

/** Which side panels are showing. Kept apart from the scene store: it is never saved or undone. */
interface LayoutState {
  /** The asset panel on the left (Biomes, Builds, …), or null when it is folded away. */
  assetTab: string | null
  /** "Hide panels" (\): both side panels go so the thumbnail fills the window. */
  focus: boolean
  /** Opens a tab; clicking the tab that is already open folds the panel away. */
  toggleAssetTab: (id: string) => void
  openAssetTab: (id: string) => void
  toggleFocus: () => void
  /** Layer groups shown open in the Layers list; every other group sits folded into its one row. */
  openGroups: string[]
  /** Clicking a group's row: folded opens like a dropdown, open folds back up. */
  toggleGroup: (groupId: string) => void
  openGroup: (groupId: string) => void
  /** Widths of the side panels and the timeline's height you dragged them to (missing: the default). */
  sizes: Partial<Record<PanelSize, number>>
  /** null goes back to the default size. */
  setSize: (panel: PanelSize, px: number | null) => void
}

/** Panels you can resize by dragging their edge. */
export type PanelSize = 'asset' | 'inspector' | 'timeline'
const SIZES_KEY = 'thumbcraft.panelSizes'

function savedSizes(): Partial<Record<PanelSize, number>> {
  try {
    return JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export const useLayout = create<LayoutState>((set) => ({
  sizes: savedSizes(),
  setSize: (panel, px) =>
    set((s) => {
      const sizes = { ...s.sizes }
      if (px === null) delete sizes[panel]
      else sizes[panel] = Math.round(px)
      try {
        localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
      } catch {
        // Not remembered this time (private window); the size still applies.
      }
      return { sizes }
    }),
  assetTab: 'biomes',
  focus: false,
  toggleAssetTab: (id) => set((s) => ({ assetTab: s.assetTab === id && !s.focus ? null : id, focus: false })),
  openAssetTab: (id) => set({ assetTab: id, focus: false }),
  toggleFocus: () => set((s) => ({ focus: !s.focus })),
  openGroups: [],
  toggleGroup: (groupId) =>
    set((s) => ({
      openGroups: s.openGroups.includes(groupId)
        ? s.openGroups.filter((g) => g !== groupId)
        : [...s.openGroups, groupId]
    })),
  openGroup: (groupId) => set((s) => (s.openGroups.includes(groupId) ? s : { openGroups: [...s.openGroups, groupId] }))
}))

/** The dragged panel sizes as CSS variables on the app (the stylesheet falls back to the defaults). */
export function panelSizes(sizes: Partial<Record<PanelSize, number>>): Record<string, string> {
  const vars: Record<string, string> = {}
  if (sizes.asset) vars['--asset-w'] = `${sizes.asset}px`
  if (sizes.inspector) vars['--inspector-w'] = `${sizes.inspector}px`
  if (sizes.timeline) vars['--timeline-h'] = `${sizes.timeline}px`
  return vars
}

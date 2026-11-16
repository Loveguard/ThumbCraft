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
}

export const useLayout = create<LayoutState>((set) => ({
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

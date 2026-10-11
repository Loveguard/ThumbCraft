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
}

export const useLayout = create<LayoutState>((set) => ({
  assetTab: 'biomes',
  focus: false,
  toggleAssetTab: (id) => set((s) => ({ assetTab: s.assetTab === id && !s.focus ? null : id, focus: false })),
  openAssetTab: (id) => set({ assetTab: id, focus: false }),
  toggleFocus: () => set((s) => ({ focus: !s.focus }))
}))

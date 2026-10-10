// The tree brush (Builds tab → Quick props): while it's on, each click on the scene plants a tree there.
import { create } from 'zustand'
import { buildTree, type TreeKind } from '@shared/minecraft/props'
import { addTerrain } from './sceneActions'
import { newId, type Vec3 } from './store'

export type TreeChoice = TreeKind | 'mixed'

export const TREE_CHOICES: { id: TreeChoice; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'oak', label: 'Oak' },
  { id: 'birch', label: 'Birch' },
  { id: 'spruce', label: 'Spruce' },
  { id: 'dark_oak', label: 'Dark oak' }
]

interface BrushState {
  /** The kind of tree being planted, or null when the brush is off. */
  trees: TreeChoice | null
  /** The group this brushing session's trees go into (so they move and hide together). */
  group: string | null
}

export const useBrush = create<BrushState>(() => ({ trees: null, group: null }))

export function startTreeBrush(trees: TreeChoice): void {
  useBrush.setState((s) => ({ trees, group: s.group ?? newId('grp') }))
}

export function stopBrush(): void {
  useBrush.setState({ trees: null, group: null })
}

const KINDS: TreeKind[] = ['oak', 'birch', 'spruce', 'dark_oak']

/** Plants one tree (a varied one each time) with its trunk at `at`, the point clicked on the ground. */
export function plantTree(at: Vec3): void {
  const { trees, group } = useBrush.getState()
  if (!trees) return
  const kind = trees === 'mixed' ? KINDS[Math.floor(Math.random() * KINDS.length)] : trees
  const t = buildTree(kind, Math.floor(Math.random() * 2 ** 31))
  const label = TREE_CHOICES.find((c) => c.id === kind)?.label ?? 'Tree'
  addTerrain(t, `${label} tree`, at, false, group ?? undefined)
}

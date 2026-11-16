import { useState, type ReactNode } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import { closeProjectTab, duplicateAsTab, showTab, startNewProject } from '../projectActions'
import { useStore } from '../store'
import { moveTab, tabProject, useTabs } from '../tabs'
import { SplitButton } from './SplitMenu'

/**
 * The open projects, one tab each, between the top bar and the workspace. Only shown once a second project is
 * open (New project, Open or Duplicate as new tab), so a single project keeps the full height.
 */
export function TabBar(): ReactNode {
  const tabs = useTabs((s) => s.tabs)
  const active = useTabs((s) => s.active)
  // The tab on screen reads its name and unsaved state live from the scene.
  useStore((s) => s.project)
  const [dragging, setDragging] = useState<string | null>(null)
  if (tabs.length < 2) return null
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t, i) => {
        const p = tabProject(t)
        return (
          <div
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            className={`project-tab ${t.key === active ? 'active' : ''} ${dragging === t.key ? 'dragging' : ''}`}
            title={p.path ?? `${p.name} (not saved to a file yet)`}
            draggable
            onDragStart={() => setDragging(t.key)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragging && dragging !== t.key) moveTab(dragging, i)
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void closeProjectTab(t.key)
              }
            }}
            onClick={() => void showTab(t.key)}
          >
            <span className="name">{p.name}</span>
            {p.dirty && <i className="dirty-dot" title="Unsaved changes" />}
            <button
              className="close"
              title="Close tab (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation()
                void closeProjectTab(t.key)
              }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      <button className="tab-add" title="New project in a new tab (Ctrl+T)" onClick={startNewProject}>
        <Plus size={14} />
      </button>
      <button
        className="tab-add"
        title="Duplicate this project as a new tab, to try a variant"
        onClick={() => void duplicateAsTab()}
      >
        <Copy size={13} />
      </button>
      <SplitButton />
    </div>
  )
}

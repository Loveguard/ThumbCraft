import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, FilePlus2, FolderOpen, History, Info, Keyboard, Save, SaveAll } from 'lucide-react'
import type { RecentProject } from '@shared/api'
import { duplicateAsTab, openProjectFile, openRecentProject, saveProject, startNewProject } from '../projectActions'
import { useStore } from '../store'
import { useDismiss } from '../useDismiss'
import { AboutDialog } from './AboutDialog'
import { ShortcutsDialog } from './ShortcutsDialog'

export const timeAgo = (t: number): string => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

/** Project name (editable), unsaved indicator and the File-style menu. */
export function ProjectMenu(): ReactNode {
  const project = useStore((s) => s.project)
  const setProject = useStore((s) => s.setProject)
  const [open, setOpen] = useState(false)
  const closeMenu = useCallback(() => setOpen(false), [])
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [about, setAbout] = useState(false)
  const [keys, setKeys] = useState(false)
  const mcVersion = useStore((s) => s.assets?.version)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) void window.blockframe.recentProjects().then(setRecent)
  }, [open])
  useDismiss(ref, closeMenu, (el) => el, open)

  const run = (fn: () => unknown): void => {
    setOpen(false)
    void fn()
  }

  return (
    <div className="project-menu" ref={ref}>
      <input
        className="project-name"
        value={project.name}
        title="Rename project"
        onChange={(e) => setProject({ name: e.target.value, dirty: true })}
        spellCheck={false}
      />
      {project.dirty && <span className="dirty-dot" title="Unsaved changes (a recovery copy is kept automatically)" />}
      <button className={`icon-btn ${open ? 'active' : ''}`} title="Project" onClick={() => setOpen(!open)}>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="menu dropdown">
          {mcVersion && (
            <div className="menu-title" title="The newest Minecraft installed on this computer">
              Minecraft {mcVersion}
            </div>
          )}
          <button onClick={() => run(startNewProject)}>
            <strong>
              <FilePlus2 size={14} /> New project <kbd>Ctrl N</kbd>
            </strong>
          </button>
          <button onClick={() => run(openProjectFile)}>
            <strong>
              <FolderOpen size={14} /> Open… <kbd>Ctrl O</kbd>
            </strong>
          </button>
          <button onClick={() => run(() => saveProject(false))}>
            <strong>
              <Save size={14} /> Save <kbd>Ctrl S</kbd>
            </strong>
          </button>
          <button onClick={() => run(() => saveProject(true))}>
            <strong>
              <SaveAll size={14} /> Save as… <kbd>Ctrl ⇧ S</kbd>
            </strong>
          </button>
          <button onClick={() => run(duplicateAsTab)}>
            <strong>
              <Copy size={14} /> Duplicate as new tab
            </strong>
            <span>A copy to try a variant, or to make a split image with</span>
          </button>
          {recent.length > 0 && (
            <>
              <div className="menu-title">
                <History size={12} /> Recent
              </div>
              {recent.slice(0, 6).map((r) => (
                <button key={r.id} onClick={() => run(() => openRecentProject(r.id))}>
                  <strong>{r.name}</strong>
                  <span>
                    {timeAgo(r.updatedAt)}
                    {r.minecraftVersion ? ` · Minecraft ${r.minecraftVersion}` : ''}
                  </span>
                </button>
              ))}
            </>
          )}
          <div className="menu-sep" />
          <button onClick={() => run(() => setKeys(true))}>
            <strong>
              <Keyboard size={14} /> Keyboard shortcuts
            </strong>
          </button>
          <button onClick={() => run(() => setAbout(true))}>
            <strong>
              <Info size={14} /> About & licences
            </strong>
          </button>
        </div>
      )}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {keys && <ShortcutsDialog onClose={() => setKeys(false)} />}
    </div>
  )
}

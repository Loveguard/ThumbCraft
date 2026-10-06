import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Download, Move3d, Redo2, Rotate3d, Ruler, Scale3d, Undo2 } from 'lucide-react'
import { LeftPanel } from './components/LeftPanel'
import { ProjectMenu } from './components/ProjectMenu'
import { openProjectFile, saveProject, startAutosave, startNewProject } from './projectActions'
import { RightPanel } from './components/RightPanel'
import { Setup } from './components/Setup'
import { returnToShot, saveShot } from './components/ViewportOverlay'
import { Viewport, viewport } from './components/Viewport'
import { encodeExport, extensionOf, sizeLabel } from './exportImage'
import { useShallow } from 'zustand/react/shallow'
import { useStore, type TransformMode } from './store'
import logo from './assets/logo.png'

const EXPORT_SIZES: [number, number, string][] = [
  [1280, 720, 'YouTube · 1280 × 720'],
  [1920, 1080, 'Full HD · 1920 × 1080'],
  [3840, 2160, '4K · 3840 × 2160'],
  [1080, 1920, 'Shorts · 1080 × 1920']
]

const TOOLS: { mode: TransformMode; icon: typeof Move3d; label: string; key: string }[] = [
  { mode: 'translate', icon: Move3d, label: 'Move', key: 'W' },
  { mode: 'rotate', icon: Rotate3d, label: 'Rotate', key: 'E' },
  { mode: 'scale', icon: Scale3d, label: 'Scale', key: 'R' }
]

/** Ticks several sizes and saves them all into one folder, named after the project. */
function BatchExport({ onClose }: { onClose: () => void }): ReactNode {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(['1280x720', '1080x1920']))
  const name = useStore((s) => s.project.name)
  const format = useStore((s) => s.settings.exportFormat)
  const run = async (): Promise<void> => {
    if (!viewport.capture) return
    const sizes = EXPORT_SIZES.filter(([w, h]) => picked.has(`${w}x${h}`))
    onClose()
    const images = []
    for (const [w, h, label] of sizes)
      images.push({
        name: `${name} - ${label.split(' · ')[0]} ${w}x${h}.${extensionOf(format)}`,
        dataUrl: await encodeExport(viewport.capture(w, h), format)
      })
    const dir = await window.blockframe.savePngs(images)
    if (dir) useStore.getState().setStatus(`Exported ${images.length} thumbnails to ${dir}`)
  }
  return (
    <div className="batch-export" role="dialog">
      <strong>Export several sizes</strong>
      {EXPORT_SIZES.map(([w, h, label]) => {
        const key = `${w}x${h}`
        return (
          <label key={key} className="check">
            <input
              type="checkbox"
              checked={picked.has(key)}
              onChange={(e) =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (e.target.checked) next.add(key)
                  else next.delete(key)
                  return next
                })
              }
            />
            <span>{label}</span>
          </label>
        )
      })}
      <p className="hint">Every size uses the same camera, so check the framing of tall (Shorts) images.</p>
      <button className="primary" disabled={!picked.size} onClick={() => void run()}>
        <Download size={15} /> Export {picked.size} {picked.size === 1 ? 'image' : 'images'}…
      </button>
    </div>
  )
}

function TopBar(): ReactNode {
  const assets = useStore((s) => s.assets)!
  const mode = useStore((s) => s.transformMode)
  const canUndo = useStore((s) => s.past.length > 0)
  const showRulers = useStore((s) => !!s.settings.showRulers)
  const canRedo = useStore((s) => s.future.length > 0)
  const [exportWidth, exportHeight, exportFormat] = useStore(
    useShallow((s) => [s.settings.exportWidth, s.settings.exportHeight, s.settings.exportFormat])
  )
  const { setTransformMode, setSettings, setStatus, undo, redo } = useStore.getState()

  const [batchOpen, setBatchOpen] = useState(false)
  const exportPng = async (): Promise<void> => {
    if (!viewport.capture) return
    const url = await encodeExport(viewport.capture(exportWidth, exportHeight), exportFormat)
    const saved = await window.blockframe.savePng(url, `thumbnail.${extensionOf(exportFormat)}`)
    if (saved) setStatus(`Exported ${saved} (${sizeLabel(url)})`)
  }

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src={logo} alt="" />
        <strong>ThumbCraft</strong>
        <i className="divider" />
        <ProjectMenu />
        <span className="chip" title="The newest Minecraft installed on this computer">
          Minecraft {assets.version}
        </span>
      </div>

      <div className="toolgroup" role="toolbar" aria-label="Transform tools">
        {TOOLS.map((t) => (
          <button
            key={t.mode}
            className={`icon-btn ${mode === t.mode ? 'active' : ''}`}
            title={`${t.label} (${t.key})`}
            onClick={() => setTransformMode(t.mode)}
          >
            <t.icon size={18} />
          </button>
        ))}
        <i className="divider" />
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={18} />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={18} />
        </button>
        <i className="divider" />
        <button
          className={`icon-btn ${showRulers ? 'active' : ''}`}
          title="Rulers and centre guides (Shift+R)"
          aria-pressed={showRulers}
          onClick={() => setSettings({ showRulers: !showRulers })}
        >
          <Ruler size={18} />
        </button>
      </div>

      <div className="export">
        <select
          className="select-btn"
          title="Export size"
          value={`${exportWidth}x${exportHeight}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number)
            setSettings({ exportWidth: w, exportHeight: h })
          }}
        >
          {EXPORT_SIZES.map(([w, h, label]) => (
            <option key={label} value={`${w}x${h}`}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="select-btn"
          title="File type: JPG fits YouTube's 2 MB limit, PNG is lossless"
          value={exportFormat}
          onChange={(e) => setSettings({ exportFormat: e.target.value as 'jpg' | 'png' })}
        >
          <option value="jpg">JPG · YouTube</option>
          <option value="png">PNG · lossless</option>
        </select>
        <div className="split-btn">
          <button className="primary" onClick={() => void exportPng()}>
            <Download size={16} />
            Export {exportFormat.toUpperCase()}
          </button>
          <button
            className="primary chevron"
            title="Export several sizes at once"
            aria-expanded={batchOpen}
            onClick={() => setBatchOpen((v) => !v)}
          >
            <ChevronDown size={15} />
          </button>
          {batchOpen && <BatchExport onClose={() => setBatchOpen(false)} />}
        </div>
      </div>
    </header>
  )
}

/** "Update ready" (Windows installs it on quit) or a link to the new release (macOS, portable). */
function UpdateNotice(): ReactNode {
  const [update, setUpdate] = useState<{ version: string; ready: boolean; url: string } | null>(null)
  useEffect(() => window.blockframe.onUpdate(setUpdate), [])
  if (!update) return null
  return update.ready ? (
    <span className="update-notice">ThumbCraft {update.version} is ready: it installs when you close the app</span>
  ) : (
    <a
      className="update-notice"
      href={update.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      ThumbCraft {update.version} is out: download it
    </a>
  )
}

function StatusBar(): ReactNode {
  const status = useStore((s) => s.status)
  const count = useStore((s) => s.objects.length)
  return (
    <footer className="status" onClick={() => useStore.getState().setStatus('')}>
      <span className={status ? 'status-msg' : ''}>
        {status ||
          'Drag to orbit · Right-drag to pan · Scroll to zoom · Hold Shift while moving to snap · Ctrl+Z to undo'}
      </span>
      <span className="status-right">
        <UpdateNotice />
        <span>
          {count} {count === 1 ? 'layer' : 'layers'}
        </span>
      </span>
    </footer>
  )
}

export function App(): ReactNode {
  const assets = useStore((s) => s.assets)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      const k = e.key.toLowerCase()
      // Project shortcuts work everywhere, including while typing in a field.
      if ((e.ctrlKey || e.metaKey) && s.assets) {
        if (k === 's') {
          e.preventDefault()
          void saveProject(e.shiftKey)
          return
        }
        if (k === 'o') {
          e.preventDefault()
          void openProjectFile()
          return
        }
        if (k === 'n') {
          e.preventDefault()
          startNewProject()
          return
        }
      }
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault()
        s.redo()
      } else if ((e.ctrlKey || e.metaKey) && k === 'd') {
        e.preventDefault()
        s.duplicateSelected()
      } else if ((e.ctrlKey || e.metaKey) && k === 'g') {
        e.preventDefault()
        if (e.shiftKey) s.ungroupSelected()
        else s.groupSelected()
      } else if ((e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault()
        // Everything but the ground, which is almost never meant to move with the rest.
        s.setSelection(s.objects.filter((o) => !(o.kind === 'terrain' && o.ground)).map((o) => o.id))
      } else if (e.ctrlKey || e.metaKey || e.altKey) return
      else if (k === 'r' && e.shiftKey) s.setSettings({ showRulers: !s.settings.showRulers })
      else if (k === 'w') s.setTransformMode('translate')
      else if (k === 'e') s.setTransformMode('rotate')
      else if (k === 'r') s.setTransformMode('scale')
      else if (k === 'c') {
        if (s.settings.shot) returnToShot()
        else saveShot()
      } else if (e.key === 'Delete' || e.key === 'Backspace') s.removeSelected()
      else if (e.key === 'Escape') {
        if (s.selectedJoint) s.selectJoint(null)
        else s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => (assets ? startAutosave() : undefined), [assets])

  if (!assets) return <Setup />
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <LeftPanel />
        <Viewport />
        <RightPanel />
      </div>
      <StatusBar />
    </div>
  )
}

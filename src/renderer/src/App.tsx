import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Download, MonitorPlay, Move3d, Redo2, Rotate3d, Ruler, Scale3d, Undo2 } from 'lucide-react'
import { YouTubePreview } from './components/YouTubePreview'
import { LeftPanel } from './components/LeftPanel'
import { ProjectMenu } from './components/ProjectMenu'
import { openProjectFile, saveProject, startAutosave, startNewProject } from './projectActions'
import { RightPanel } from './components/RightPanel'
import { Setup } from './components/Setup'
import { returnToShot, saveShot } from './components/ViewportOverlay'
import { Viewport, viewport } from './components/Viewport'
import { encodeExport, extensionOf, sizeLabel } from './exportImage'
import { useShallow } from 'zustand/react/shallow'
import { inShot, shotLabel, useStore, type TransformMode } from './store'
import { captureFrame, eachShot } from './capture'
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

/**
 * Ticks several sizes (and, with several shots, which shots) and saves them all into one folder, named after the
 * project. Three shots at 1280 × 720 are exactly what YouTube's Test & Compare takes.
 */
function BatchExport({ onClose }: { onClose: () => void }): ReactNode {
  const shots = useStore((s) => s.shots)
  const multi = shots.length > 1
  const [picked, setPicked] = useState<Set<string>>(() => new Set(multi ? ['1280x720'] : ['1280x720', '1080x1920']))
  const [pickedShots, setPickedShots] = useState<Set<string>>(() => new Set(shots.map((x) => x.id)))
  const name = useStore((s) => s.project.name)
  const format = useStore((s) => s.settings.exportFormat)
  const toggle = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string, on: boolean): void =>
    set((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const shotIds = multi ? shots.filter((x) => pickedShots.has(x.id)).map((x) => x.id) : [shots[0].id]
  const total = picked.size * shotIds.length
  const run = async (): Promise<void> => {
    const sizes = EXPORT_SIZES.filter(([w, h]) => picked.has(`${w}x${h}`))
    onClose()
    const ext = extensionOf(format)
    const perShot = await eachShot(shotIds, async (id) => {
      const letter = multi ? ` - ${shotLabel(shots, id)}` : ''
      const out = []
      for (const [w, h, label] of sizes) {
        const size = sizes.length > 1 || !multi ? ` - ${label.split(' · ')[0]} ${w}x${h}` : ''
        out.push({
          name: `${name}${letter}${size}.${ext}`,
          dataUrl: await encodeExport(await captureFrame(w, h), format)
        })
      }
      return out
    })
    const images = perShot.flat()
    const dir = await window.blockframe.savePngs(images)
    if (dir)
      useStore
        .getState()
        .setStatus(
          `Exported ${images.length} thumbnails to ${dir}` +
            (multi ? '. Upload the A/B/C files to YouTube Studio → Test & Compare.' : '')
        )
  }
  return (
    <div className="batch-export" role="dialog">
      <strong>{multi ? 'Export shots for Test & Compare' : 'Export several sizes'}</strong>
      {multi && (
        <div className="batch-shots">
          {shots.map((sh) => (
            <label key={sh.id} className="check">
              <input
                type="checkbox"
                checked={pickedShots.has(sh.id)}
                onChange={(e) => toggle(setPickedShots, sh.id, e.target.checked)}
              />
              <span>Shot {shotLabel(shots, sh.id)}</span>
            </label>
          ))}
        </div>
      )}
      {EXPORT_SIZES.map(([w, h, label]) => {
        const key = `${w}x${h}`
        return (
          <label key={key} className="check">
            <input
              type="checkbox"
              checked={picked.has(key)}
              onChange={(e) => toggle(setPicked, key, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        )
      })}
      <p className="hint">
        {multi
          ? 'Each shot is saved as its own file (… - A, - B, - C). YouTube Studio → Test & Compare tries up to three.'
          : 'Every size uses the same camera, so check the framing of tall (Shorts) images.'}
      </p>
      <button className="primary" disabled={!total} onClick={() => void run()}>
        <Download size={15} /> Export {total} {total === 1 ? 'image' : 'images'}…
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
  const [previewOpen, setPreviewOpen] = useState(false)
  const exportPng = async (): Promise<void> => {
    if (!viewport.capture) return
    const url = await encodeExport(await captureFrame(exportWidth, exportHeight), exportFormat)
    const { shots, activeShot } = useStore.getState()
    const letter = shots.length > 1 ? ` - ${shotLabel(shots, activeShot)}` : ''
    const saved = await window.blockframe.savePng(url, `thumbnail${letter}.${extensionOf(exportFormat)}`)
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
        <button
          className="icon-btn"
          title="How it looks on YouTube: home feed, search, up next and phone, every shot side by side"
          onClick={() => setPreviewOpen(true)}
        >
          <MonitorPlay size={18} />
        </button>
        {previewOpen && <YouTubePreview onClose={() => setPreviewOpen(false)} />}
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
            title="Export several sizes, or every shot for YouTube's Test & Compare"
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
  const count = useStore((s) => s.objects.filter((o) => inShot(o, s.activeShot)).length)
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
        s.setSelection(
          s.objects.filter((o) => inShot(o, s.activeShot) && !(o.kind === 'terrain' && o.ground)).map((o) => o.id)
        )
      } else if (e.ctrlKey || e.metaKey || e.altKey) return
      else if (k === 'r' && e.shiftKey) s.setSettings({ showRulers: !s.settings.showRulers })
      else if (['1', '2', '3'].includes(k) && s.shots[Number(k) - 1]) s.switchShot(s.shots[Number(k) - 1].id)
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

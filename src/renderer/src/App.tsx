import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Download, Layers2, MonitorPlay } from 'lucide-react'
import { YouTubePreview } from './components/YouTubePreview'
import { TabBar } from './components/TabBar'
import { LeftPanel } from './components/LeftPanel'
import { ProjectMenu } from './components/ProjectMenu'
import { openProjectFile, saveProject, showTab, startAutosave, startNewProject } from './projectActions'
import { useTabs } from './tabs'
import { RightPanel } from './components/RightPanel'
import { Setup } from './components/Setup'
import { returnToShot, saveShot } from './components/ViewportOverlay'
import { Viewport, viewport } from './components/Viewport'
import { encodeExport, extensionOf, overYouTubeLimit, reportExportError, sizeLabel } from './exportImage'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from './store'
import { useLayout } from './layout'
import { captureFrame } from './capture'
import { useDismiss } from './useDismiss'
import logo from './assets/logo.png'

const EXPORT_SIZES: [number, number, string][] = [
  [1280, 720, 'YouTube · 1280 × 720'],
  [1920, 1080, 'Full HD · 1920 × 1080'],
  [3840, 2160, '4K · 3840 × 2160'],
  [1080, 1920, 'Shorts · 1080 × 1920']
]

/** Ticks several sizes and saves them all into one folder, named after the project. */
function BatchExport({ onClose }: { onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(['1280x720', '1080x1920']))
  const name = useStore((s) => s.project.name)
  const format = useStore((s) => s.settings.exportFormat)
  const run = async (): Promise<void> => {
    const sizes = EXPORT_SIZES.filter(([w, h]) => picked.has(`${w}x${h}`))
    onClose()
    const images = []
    for (const [w, h, label] of sizes)
      images.push({
        name: `${name} - ${label.split(' · ')[0]} ${w}x${h}.${extensionOf(format)}`,
        dataUrl: await encodeExport(await captureFrame(w, h), format)
      })
    const dir = await window.blockframe.savePngs(images)
    const over = images.filter((i) => overYouTubeLimit(i.dataUrl)).length
    if (dir)
      useStore
        .getState()
        .setStatus(
          `Exported ${images.length} thumbnails to ${dir}` +
            (over ? `; ${over} of them ${over > 1 ? 'are' : 'is'} over YouTube's 2 MB limit` : '')
        )
  }
  return (
    <div className="batch-export" role="dialog" ref={ref}>
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
      <button className="primary" disabled={!picked.size} onClick={() => void run().catch(reportExportError)}>
        <Download size={15} /> Export {picked.size} {picked.size === 1 ? 'image' : 'images'}…
      </button>
    </div>
  )
}

/** Size, file type and batch export, folded behind the Export button's arrow. */
function ExportMenu({ onClose }: { onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const [batch, setBatch] = useState(false)
  const [w, h, format] = useStore(
    useShallow((s) => [s.settings.exportWidth, s.settings.exportHeight, s.settings.exportFormat])
  )
  const setSettings = useStore((s) => s.setSettings)
  if (batch) return <BatchExport onClose={onClose} />
  return (
    <div className="menu export-menu" role="menu" ref={ref}>
      <div className="menu-title">Size</div>
      {EXPORT_SIZES.map(([ew, eh, label]) => {
        const [name, dims] = label.split(' · ')
        return (
          <button
            key={label}
            role="menuitemradio"
            aria-checked={ew === w && eh === h}
            className={ew === w && eh === h ? 'checked' : ''}
            onClick={() => setSettings({ exportWidth: ew, exportHeight: eh })}
          >
            <strong>
              <Check size={14} className="tick" /> {name}
            </strong>
            <span>{dims}</span>
          </button>
        )
      })}
      <div className="menu-title">File type</div>
      <div className="segmented">
        <button
          className={format === 'jpg' ? 'active' : ''}
          title="Fits YouTube's 2 MB limit"
          onClick={() => setSettings({ exportFormat: 'jpg' })}
        >
          JPG
        </button>
        <button
          className={format === 'png' ? 'active' : ''}
          title="Lossless, larger files"
          onClick={() => setSettings({ exportFormat: 'png' })}
        >
          PNG
        </button>
      </div>
      <div className="menu-sep" />
      <button onClick={() => setBatch(true)}>
        <strong>
          <Layers2 size={14} /> Export several sizes…
        </strong>
      </button>
    </div>
  )
}

/**
 * Only what a session starts and ends with: the project on the left, preview and export on the right. Editing
 * tools live in the dock at the bottom of the viewport.
 */
function TopBar(): ReactNode {
  const [exportWidth, exportHeight, exportFormat] = useStore(
    useShallow((s) => [s.settings.exportWidth, s.settings.exportHeight, s.settings.exportFormat])
  )
  const setStatus = useStore((s) => s.setStatus)
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const exportPng = async (): Promise<void> => {
    if (!viewport.capture) return
    const url = await encodeExport(await captureFrame(exportWidth, exportHeight), exportFormat)
    const saved = await window.blockframe.savePng(url, `thumbnail.${extensionOf(exportFormat)}`)
    if (saved)
      setStatus(
        `Exported ${saved} (${sizeLabel(url)})` +
          (overYouTubeLimit(url) ? ": over YouTube's 2 MB limit, export a smaller size for YouTube" : '')
      )
  }

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src={logo} alt="ThumbCraft" title="ThumbCraft" />
        <ProjectMenu />
      </div>

      <div className="export">
        <UpdateNotice />
        <button
          className="ghost"
          title="How it looks on YouTube: home feed, search, up next and on a phone"
          onClick={() => setPreviewOpen(true)}
        >
          <MonitorPlay size={16} />
          Preview
        </button>
        {previewOpen && <YouTubePreview onClose={() => setPreviewOpen(false)} />}
        <div className="split-btn">
          <button
            className="primary"
            title={`Export ${exportWidth} × ${exportHeight} ${exportFormat.toUpperCase()}`}
            onClick={() => void exportPng().catch(reportExportError)}
          >
            <Download size={16} />
            Export
          </button>
          <button
            className="primary chevron"
            title="Size, file type and several sizes at once"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <ChevronDown size={15} />
          </button>
          {menuOpen && <ExportMenu onClose={() => setMenuOpen(false)} />}
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
    <span className="update-notice" title="It installs when you close the app">
      {update.version} ready
    </span>
  ) : (
    <a className="update-notice" href={update.url} target="_blank" rel="noreferrer" title="Download the new version">
      {update.version} is out
    </a>
  )
}

/**
 * Messages (exports, errors, warnings) float briefly over the bottom of the viewport instead of filling a
 * permanent status bar. Hovering keeps one up; clicking dismisses it.
 */
function StatusToast(): ReactNode {
  const status = useStore((s) => s.status)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (!status || paused) return
    const t = setTimeout(() => useStore.getState().setStatus(''), Math.min(15000, 5000 + status.length * 60))
    return () => clearTimeout(t)
  }, [status, paused])
  if (!status) return null
  return (
    <div
      className="status-toast"
      role="status"
      title="Click to dismiss"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => {
        setPaused(false)
        useStore.getState().setStatus('')
      }}
    >
      {status}
    </div>
  )
}

export function App(): ReactNode {
  const assets = useStore((s) => s.assets)
  const tabbed = useTabs((s) => s.tabs.length > 1)
  const focus = useLayout((s) => s.focus)

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
        if (k === 'n' || k === 't') {
          e.preventDefault()
          startNewProject()
          return
        }
        if (e.key === 'Tab') {
          // Ctrl+Tab / Ctrl+Shift+Tab: next / previous open project.
          e.preventDefault()
          const { tabs, active } = useTabs.getState()
          const i = tabs.findIndex((t) => t.key === active)
          const next = tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]
          if (next) void showTab(next.key)
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
      else if (e.key === '\\') useLayout.getState().toggleFocus()
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
    <div className={`app ${tabbed ? 'with-tabs' : ''} ${focus ? 'focus' : ''}`}>
      <TopBar />
      <TabBar />
      <div className="workspace">
        <LeftPanel />
        <Viewport />
        <RightPanel />
      </div>
      <StatusToast />
    </div>
  )
}

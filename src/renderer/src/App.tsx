import { useEffect, useRef, useState, type ReactNode } from 'react'
import { startClaudeBridge } from './claudeBridge'
import { Check, ChevronDown, Download, FileStack, Film, Image, Layers2, MonitorPlay } from 'lucide-react'
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
import { panelSizes, useLayout } from './layout'
import { captureFrame } from './capture'
import { layeredPsd } from './layeredExport'
import { useDismiss } from './useDismiss'
import logo from './assets/logo.png'
import {
  copyClip,
  cutClip,
  deleteClip,
  duplicateClip,
  hasClipboard,
  pasteClip,
  enterAnimation,
  exitAnimation,
  canWalk,
  removePathPoint,
  pause,
  play,
  redoAnimation,
  undoAnimation,
  useAnim
} from './animation'
import {
  cancelVideo,
  EXPORT_KINDS,
  EXPORT_SIZES as MOVIE_SIZES,
  exportAnimation,
  sendFrameToThumbnail,
  type VideoProgress
} from './videoExport'

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

/** The thumbnail as a layered Photoshop file, at the chosen export size. */
async function exportPsd(w: number, h: number): Promise<void> {
  const { setStatus, project } = useStore.getState()
  setStatus('Rendering layers…')
  const bytes = await layeredPsd(w, h)
  const saved = await window.blockframe.savePsd(bytes, `${project.name || 'thumbnail'} layers.psd`)
  if (saved) setStatus(`Exported layers to ${saved}`)
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
      <button
        title="A .psd with the sky, the terrain and each build, mob, player, title and sticker on its own layer, and each effect in a folder with its glow, so hiding an effect takes its light off the rest"
        onClick={() => {
          onClose()
          void exportPsd(w, h).catch(reportExportError)
        }}
      >
        <strong>
          <FileStack size={14} /> Layers for Photoshop (.psd)…
        </strong>
      </button>
    </div>
  )
}

/** One click for the usual places a clip goes: the kind of file and the size together. */
const QUICK_EXPORTS = [
  { id: 'youtube', label: 'YouTube', kind: 'video', size: '1080p', hint: 'A 1920 × 1080 video' },
  {
    id: 'shorts',
    label: 'Shorts',
    kind: 'video',
    size: 'shorts',
    hint: 'A tall 1080 × 1920 video, the character kept in the middle'
  },
  { id: 'gif', label: 'GIF', kind: 'gif', size: 'thumb', hint: 'A GIF the size of the thumbnail' }
] as const

/** What the animation is exported as and at what size, folded behind the Export video button's arrow. */
function MovieMenu({ onClose }: { onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const { exportKind, exportSize, blur, follow } = useAnim(
    useShallow((a) => ({ exportKind: a.exportKind, exportSize: a.exportSize, blur: a.blur, follow: a.follow }))
  )
  const people = useStore((s) => s.objects).filter(canWalk)
  const selectedId = useStore((s) => s.selectedId)
  return (
    <div className="menu export-menu" role="menu" ref={ref}>
      <div className="menu-title">Quick pick</div>
      <div className="segmented">
        {QUICK_EXPORTS.map((q) => {
          const on = exportKind === q.kind && exportSize === q.size
          return (
            <button
              key={q.id}
              className={on ? 'active' : ''}
              title={q.hint}
              onClick={() =>
                useAnim.setState({
                  exportKind: q.kind,
                  exportSize: q.size,
                  // A tall video keeps the selected (or first) character in the middle.
                  ...(q.id === 'shorts' && !follow
                    ? { follow: (people.find((p) => p.id === selectedId) ?? people[0])?.id ?? null }
                    : {})
                })
              }
            >
              {q.label}
            </button>
          )
        })}
      </div>
      <div className="menu-title">Export as</div>
      {EXPORT_KINDS.map((k) => (
        <button
          key={k.id}
          role="menuitemradio"
          aria-checked={exportKind === k.id}
          className={exportKind === k.id ? 'checked' : ''}
          title={k.hint}
          onClick={() => useAnim.setState({ exportKind: k.id })}
        >
          <strong>
            <Check size={14} className="tick" /> {k.label}
          </strong>
        </button>
      ))}
      <div className="menu-title">Size</div>
      {MOVIE_SIZES.map((z) => (
        <button
          key={z.id}
          role="menuitemradio"
          aria-checked={exportSize === z.id}
          className={exportSize === z.id ? 'checked' : ''}
          onClick={() => useAnim.setState({ exportSize: z.id })}
        >
          <strong>
            <Check size={14} className="tick" /> {z.label}
          </strong>
        </button>
      ))}
      <div className="menu-title">Motion blur</div>
      <div className="segmented">
        {(
          [
            [1, 'Off'],
            [4, 'Light'],
            [8, 'Smooth']
          ] as const
        ).map(([n, label]) => (
          <button key={n} className={blur === n ? 'active' : ''} onClick={() => useAnim.setState({ blur: n })}>
            {label}
          </button>
        ))}
      </div>
      {people.length > 0 && (
        <>
          <div className="menu-title">Keep in the middle</div>
          <select
            className="menu-select"
            value={follow && people.some((p) => p.id === follow) ? follow : ''}
            onChange={(e) => useAnim.setState({ follow: e.target.value || null })}
            title="Slides the camera sideways so this character stays centred: for a tall video cut from a wide scene"
          >
            <option value="">Nobody (the camera as it is)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="menu-sep" />
      <button
        title="Starts a new project tab with everything as it is at the playhead, to make a thumbnail of it"
        onClick={() => {
          onClose()
          sendFrameToThumbnail()
        }}
      >
        <strong>
          <Image size={14} /> Send this frame to a thumbnail tab
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
  const animating = useAnim((s) => s.mode === 'animation')
  const [video, setVideo] = useState<VideoProgress | null>(null)
  const [movieMenu, setMovieMenu] = useState(false)
  const exportMovie = async (): Promise<void> => {
    setVideo({ frame: 0, frames: 1 })
    try {
      const { exportKind, exportSize, blur, follow } = useAnim.getState()
      const size = MOVIE_SIZES.find((z) => z.id === exportSize)?.size ?? [exportWidth, exportHeight]
      const saved = await exportAnimation(
        { kind: exportKind, width: size[0], height: size[1], blur, follow: follow ?? null },
        setVideo
      )
      if (saved) setStatus(`Exported ${saved}`)
    } finally {
      setVideo(null)
    }
  }
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

      <div className="segmented mode-switch" role="tablist" aria-label="Mode">
        <button
          role="tab"
          aria-selected={!animating}
          className={!animating ? 'active' : ''}
          title="Make a thumbnail: every tool"
          onClick={exitAnimation}
        >
          Thumbnail
        </button>
        <button
          role="tab"
          aria-selected={animating}
          className={animating ? 'active' : ''}
          title="Animate characters along paths, and export a video"
          onClick={() => {
            enterAnimation()
            useLayout.getState().openAssetTab('animate')
          }}
        >
          Animation
        </button>
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
        {animating ? (
          <div className="split-btn">
            <button
              className="primary"
              title="Export the animation (the arrow picks the kind of file and the size)"
              disabled={!!video}
              onClick={() => void exportMovie().catch(reportExportError)}
            >
              <Film size={16} />
              Export
            </button>
            <button
              className="primary chevron"
              title="File type, size, motion blur, and sending a frame to a thumbnail tab"
              aria-expanded={movieMenu}
              onClick={() => setMovieMenu((v) => !v)}
            >
              <ChevronDown size={15} />
            </button>
            {movieMenu && <MovieMenu onClose={() => setMovieMenu(false)} />}
          </div>
        ) : (
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
        )}
      </div>
      {video && (
        <div className="video-progress" role="status">
          <span>
            Rendering: frame {video.frame} of {video.frames}
          </span>
          <progress max={video.frames} value={video.frame} />
          <button className="ghost" onClick={cancelVideo}>
            Cancel
          </button>
        </div>
      )}
    </header>
  )
}

/** "Update ready" (Windows installs it on quit) or a link to the new release (macOS, portable). */
function UpdateNotice(): ReactNode {
  const [update, setUpdate] = useState<{ version: string; ready: boolean; url: string } | null>(null)
  useEffect(() => window.blockframe.onUpdate(setUpdate), [])
  useEffect(() => startClaudeBridge(), [])
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
  const sizes = useLayout((s) => s.sizes)

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
      const anim = useAnim.getState()
      const animating = anim.mode === 'animation'
      // Copy, cut, paste and duplicate the selected block.
      if (
        animating &&
        (e.ctrlKey || e.metaKey) &&
        ['c', 'x', 'v', 'd'].includes(k) &&
        (anim.selectedClip || (k === 'v' && hasClipboard()))
      ) {
        const sel = anim.selectedClip
        const target = sel?.objectId ?? useStore.getState().selectedId
        e.preventDefault()
        if (k === 'c') copyClip()
        else if (k === 'x') cutClip()
        else if (k === 'd') duplicateClip()
        else if (target) pasteClip(target, anim.time)
        return
      }
      if (animating && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Adding path points: Enter or Esc stops.
        if (anim.addingPoints && (e.key === 'Enter' || e.key === 'Escape')) {
          e.preventDefault()
          useAnim.setState({ addingPoints: false })
          return
        }
        // Delete takes away the picked path point, else the selected block.
        if ((e.key === 'Delete' || e.key === 'Backspace') && anim.selectedClip) {
          e.preventDefault()
          if (anim.selectedPoint !== null) removePathPoint(anim.selectedPoint)
          else deleteClip(anim.selectedClip.objectId, anim.selectedClip.clipId)
          return
        }
        if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) {
          e.preventDefault()
          if (anim.playing) pause()
          else play()
          return
        }
      }
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        if (animating) {
          if (e.shiftKey) redoAnimation()
          else undoAnimation()
        } else if (e.shiftKey) s.redo()
        else s.undo()
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault()
        if (animating) redoAnimation()
        else s.redo()
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
    <div className={`app ${tabbed ? 'with-tabs' : ''} ${focus ? 'focus' : ''}`} style={panelSizes(sizes)}>
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

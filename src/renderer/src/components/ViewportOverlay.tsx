import { useCallback, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Camera,
  Clapperboard,
  Copy,
  Grid3x3,
  Magnet,
  Maximize,
  Maximize2,
  Minimize2,
  Move3d,
  Redo2,
  Rotate3d,
  Ruler,
  Scale3d,
  Trash2,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cameraBridge, useStore, type TransformMode } from '../store'
import { useLayout } from '../layout'
import { pushAlongView } from './RightPanel'
import { StartPanel } from './StartPanel'
import { drawnBox, viewport } from './Viewport'
import { useDismiss } from '../useDismiss'

/** Bounding box of the given objects (or all visible objects). */
function boundsOf(ids?: string[]): THREE.Box3 | null {
  const box = new THREE.Box3()
  for (const [id, o] of viewport.objects) {
    if (ids && !ids.includes(id)) continue
    if (!o.visible) continue
    // What it draws (a beacon's sky-high beam doesn't count); a light or other bodiless object counts as its spot.
    const drawn = drawnBox(o)
    if (drawn.isEmpty()) box.expandByPoint(o.getWorldPosition(new THREE.Vector3()))
    else box.union(drawn)
  }
  return box.isEmpty() ? null : box
}

/** Points the camera at a box from a direction, far enough away to fit it. */
function frame(box: THREE.Box3, dir?: THREE.Vector3): void {
  const cam = viewport.camera
  const controls = viewport.controls
  if (!cam || !controls) return
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2)
  const before = cameraBridge.get?.()
  const d = dir ?? cam.position.clone().sub(controls.target).normalize()
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2)) * 1.05
  controls.target.copy(center)
  cam.position.copy(center).addScaledVector(d.normalize(), dist)
  cam.lookAt(center)
  controls.update()
  if (before) useStore.getState().recordCamera(before, 0) // its own undo step
}

/** Saves the current view as the shot. */
export function saveShot(): void {
  const cam = cameraBridge.get?.()
  if (!cam || !viewport.camera) return
  useStore.getState().setSettings({ shot: { ...cam, fov: viewport.camera.fov } })
  useStore.getState().setStatus('View saved. Look around freely; press C or "Back to view" to return.')
}

/** Puts the camera back on the saved shot (undoable like any camera move). */
export function returnToShot(): void {
  const { settings, recordCamera, setSettings } = useStore.getState()
  const before = cameraBridge.get?.()
  if (!settings.shot || !before) return
  cameraBridge.set?.(settings.shot)
  if (settings.fov !== settings.shot.fov) setSettings({ fov: settings.shot.fov })
  recordCamera(before, 0)
}

/** Thumbnail-friendly camera angles around the selection (or the whole scene). */
const ANGLES: { label: string; dir: [number, number, number]; hint: string }[] = [
  { label: 'Front', dir: [0, 0.18, 1], hint: 'Straight on, slightly above' },
  { label: 'Hero', dir: [0.55, -0.12, 0.85], hint: 'Low angle looking up — makes subjects look epic' },
  { label: 'Three-quarter', dir: [0.7, 0.35, 0.7], hint: 'Classic diagonal view' },
  { label: 'Side', dir: [1, 0.15, 0], hint: 'Profile view' },
  { label: 'Bird’s-eye', dir: [0.3, 1.4, 0.4], hint: 'High overview of a build or biome' }
]

function CameraMenu({ onClose }: { onClose: () => void }): ReactNode {
  const selectedId = useStore((s) => s.selectedId)
  const ref = useRef<HTMLDivElement>(null)
  // The whole anchor counts as inside, so pressing the Camera button toggles the menu shut.
  useDismiss(ref, onClose, (el) => el.closest('.menu-anchor'))
  const apply = (dir: [number, number, number]): void => {
    const box = boundsOf(selectedId ? [selectedId] : undefined) ?? boundsOf()
    if (box) frame(box, new THREE.Vector3(...dir))
    onClose()
  }
  const shot = useStore((s) => s.settings.shot)
  return (
    <div className="menu" ref={ref}>
      <div className="menu-title">Your saved view</div>
      <button
        onClick={() => {
          saveShot()
          onClose()
        }}
      >
        <strong>{shot ? 'Replace the saved view with this one' : 'Save this view'}</strong>
        <span>Look around freely, then jump back with one click (C)</span>
      </button>
      {shot && (
        <button
          onClick={() => {
            useStore.getState().setSettings({ shot: null })
            onClose()
          }}
        >
          <strong>Forget saved view</strong>
          <span>Removes the bookmark; the camera stays where it is</span>
        </button>
      )}
      <div className="menu-title">{selectedId ? 'Aim at selection' : 'Aim at scene'}</div>
      {ANGLES.map((a) => (
        <button key={a.label} onClick={() => apply(a.dir)}>
          <strong>{a.label}</strong>
          <span>{a.hint}</span>
        </button>
      ))}
    </div>
  )
}

const TOOLS: { mode: TransformMode; icon: LucideIcon; label: string; key: string }[] = [
  { mode: 'translate', icon: Move3d, label: 'Move', key: 'W' },
  { mode: 'rotate', icon: Rotate3d, label: 'Rotate', key: 'E' },
  { mode: 'scale', icon: Scale3d, label: 'Scale', key: 'R' }
]

/**
 * The one toolbar: transform tools, undo, camera and view aids, docked under the canvas. Icons only; each names
 * itself and its shortcut on hover.
 */
function Dock(): ReactNode {
  const mode = useStore((s) => s.transformMode)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const { showGrid, snap, shot, showRulers } = useStore(
    useShallow((s) => ({
      showGrid: s.settings.showGrid,
      snap: s.settings.snap,
      shot: s.settings.shot,
      showRulers: !!s.settings.showRulers
    }))
  )
  const focus = useLayout((s) => s.focus)
  const { setSettings, setTransformMode, undo, redo } = useStore.getState()
  const [menu, setMenu] = useState(false)
  const closeMenu = useCallback(() => setMenu(false), [])

  return (
    <div className="float-bar view-bar dock" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.mode}
          className={`icon-btn ${mode === t.mode ? 'active' : ''}`}
          data-tip={`${t.label}  ${t.key}`}
          aria-label={t.label}
          onClick={() => setTransformMode(t.mode)}
        >
          <t.icon size={17} />
        </button>
      ))}
      <i className="dock-gap" />
      <button className="icon-btn" data-tip="Undo  Ctrl Z" aria-label="Undo" disabled={!canUndo} onClick={undo}>
        <Undo2 size={17} />
      </button>
      <button className="icon-btn" data-tip="Redo  Ctrl Y" aria-label="Redo" disabled={!canRedo} onClick={redo}>
        <Redo2 size={17} />
      </button>
      <i className="dock-gap" />
      <div className="menu-anchor">
        <button
          className={`icon-btn ${menu ? 'active' : ''}`}
          onClick={() => setMenu(!menu)}
          data-tip={menu ? undefined : 'Camera angles'}
          aria-label="Camera angles"
          aria-expanded={menu}
        >
          <Camera size={17} />
        </button>
        {menu && <CameraMenu onClose={closeMenu} />}
      </div>
      <button
        className={`icon-btn ${shot ? 'shot-set' : ''}`}
        onClick={() => (shot ? returnToShot() : saveShot())}
        data-tip={shot ? 'Back to saved view  C' : 'Save this view  C'}
        aria-label={shot ? 'Back to saved view' : 'Save this view'}
      >
        {shot ? <Clapperboard size={17} /> : <BookmarkPlus size={17} />}
      </button>
      <button
        className="icon-btn"
        onClick={() => {
          const box = boundsOf()
          if (box) frame(box)
        }}
        data-tip="Fit everything in view"
        aria-label="Fit everything in view"
      >
        <Maximize size={17} />
      </button>
      <i className="dock-gap" />
      <button
        className={`icon-btn ${showGrid ? 'active' : ''}`}
        onClick={() => setSettings({ showGrid: !showGrid })}
        data-tip="Ground grid (never exported)"
        aria-label="Ground grid"
        aria-pressed={showGrid}
      >
        <Grid3x3 size={17} />
      </button>
      <button
        className={`icon-btn ${snap ? 'active' : ''}`}
        onClick={() => setSettings({ snap: !snap })}
        data-tip="Snap while moving  hold Shift"
        aria-label="Snap while moving"
        aria-pressed={snap}
      >
        <Magnet size={17} />
      </button>
      <button
        className={`icon-btn ${showRulers ? 'active' : ''}`}
        onClick={() => setSettings({ showRulers: !showRulers })}
        data-tip="Rulers and centre guides  Shift R"
        aria-label="Rulers and centre guides"
        aria-pressed={showRulers}
      >
        <Ruler size={17} />
      </button>
      <i className="dock-gap" />
      <button
        className={`icon-btn ${focus ? 'active' : ''}`}
        onClick={() => useLayout.getState().toggleFocus()}
        data-tip={focus ? 'Show panels  \\' : 'Hide panels  \\'}
        aria-label="Hide panels"
        aria-pressed={focus}
      >
        {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
      </button>
    </div>
  )
}

/** Floating UI drawn over the 3D canvas: the start panel, selection actions and the dock. */
export function ViewportOverlay(): ReactNode {
  const selectedId = useStore((s) => s.selectedId)
  const selected = useStore((s) => s.objects.find((o) => o.id === s.selectedId))
  const { duplicateSelected, removeSelected } = useStore.getState()

  return (
    <div className="overlay">
      <StartPanel />

      <div
        className="float-bar selection-bar"
        ref={(el) => void (viewport.selectionToolbar = el)}
        style={{ visibility: 'hidden', display: selectedId ? undefined : 'none' }}
      >
        {selected && (
          <>
            <button className="icon-btn" title="Duplicate (Ctrl+D)" onClick={duplicateSelected}>
              <Copy size={16} />
            </button>
            <button className="icon-btn" title="Bring forward (toward camera)" onClick={() => pushAlongView(1)}>
              <ArrowUp size={16} />
            </button>
            <button className="icon-btn" title="Send back (away from camera)" onClick={() => pushAlongView(-1)}>
              <ArrowDown size={16} />
            </button>
            <button className="icon-btn danger" title="Delete (Del)" onClick={removeSelected}>
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>

      <Dock />
    </div>
  )
}

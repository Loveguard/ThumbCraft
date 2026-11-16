import { useCallback, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import {
  Camera,
  Check,
  Clapperboard,
  Grid3x3,
  Maximize2,
  Minimize2,
  Move3d,
  Redo2,
  Rotate3d,
  Scale3d,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cameraBridge, useStore, type TransformMode } from '../store'
import { useLayout } from '../layout'
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
      <button
        onClick={() => {
          const box = boundsOf()
          if (box) frame(box)
          onClose()
        }}
      >
        <strong>Fit everything</strong>
        <span>Frames the whole scene from where you are looking</span>
      </button>
      {ANGLES.map((a) => (
        <button key={a.label} onClick={() => apply(a.dir)}>
          <strong>{a.label}</strong>
          <span>{a.hint}</span>
        </button>
      ))}
    </div>
  )
}

/** The view aids (never exported): ground grid, snapping and rulers, as switches in one small menu. */
function ViewMenu({ onClose }: { onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, (el) => el.closest('.menu-anchor'))
  const { showGrid, snap, showRulers } = useStore(
    useShallow((s) => ({ showGrid: s.settings.showGrid, snap: s.settings.snap, showRulers: !!s.settings.showRulers }))
  )
  const { setSettings } = useStore.getState()
  const items = [
    {
      on: showGrid,
      label: 'Ground grid',
      hint: 'Only in the editor, never exported',
      flip: () => setSettings({ showGrid: !showGrid })
    },
    {
      on: snap,
      label: 'Snap while moving',
      hint: 'Or hold Shift while dragging',
      flip: () => setSettings({ snap: !snap })
    },
    {
      on: showRulers,
      label: 'Rulers and centre guides',
      hint: 'Shift R',
      flip: () => setSettings({ showRulers: !showRulers })
    }
  ]
  return (
    <div className="menu view-menu" ref={ref}>
      <div className="menu-title">Show while editing</div>
      {items.map((i) => (
        <button
          key={i.label}
          className={i.on ? 'checked' : ''}
          role="menuitemcheckbox"
          aria-checked={i.on}
          onClick={i.flip}
        >
          <strong>
            <Check size={14} className="tick" style={{ visibility: i.on ? 'visible' : 'hidden' }} /> {i.label}
          </strong>
          <span>{i.hint}</span>
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
  const shot = useStore((s) => s.settings.shot)
  const focus = useLayout((s) => s.focus)
  const { setTransformMode, undo, redo } = useStore.getState()
  const [menu, setMenu] = useState<'camera' | 'view' | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

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
          className={`icon-btn ${menu === 'camera' ? 'active' : ''}`}
          onClick={() => setMenu(menu === 'camera' ? null : 'camera')}
          data-tip={menu ? undefined : 'Camera: angles, fit, saved view'}
          aria-label="Camera"
          aria-expanded={menu === 'camera'}
        >
          <Camera size={17} />
        </button>
        {menu === 'camera' && <CameraMenu onClose={closeMenu} />}
      </div>
      {shot && (
        <button
          className="icon-btn shot-set"
          onClick={returnToShot}
          data-tip="Back to saved view  C"
          aria-label="Back to saved view"
        >
          <Clapperboard size={17} />
        </button>
      )}
      <div className="menu-anchor">
        <button
          className={`icon-btn ${menu === 'view' ? 'active' : ''}`}
          onClick={() => setMenu(menu === 'view' ? null : 'view')}
          data-tip={menu ? undefined : 'Grid, snapping and rulers'}
          aria-label="View aids"
          aria-expanded={menu === 'view'}
        >
          <Grid3x3 size={17} />
        </button>
        {menu === 'view' && <ViewMenu onClose={closeMenu} />}
      </div>
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

/** Floating UI drawn over the 3D canvas: the start sheet and the dock. */
export function ViewportOverlay(): ReactNode {
  return (
    <div className="overlay">
      <StartPanel />
      <Dock />
    </div>
  )
}

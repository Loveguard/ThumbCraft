import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
  Trash2
} from 'lucide-react'
import { cameraBridge, useStore } from '../store'
import { pushAlongView } from './RightPanel'
import { hasEffects } from './Effects'
import { StartPanel } from './StartPanel'
import { viewport } from './Viewport'
import { RENDER_MODES } from '../renderModes'

/** Bounding box of the given objects (or all visible objects). */
function boundsOf(ids?: string[]): THREE.Box3 | null {
  const box = new THREE.Box3()
  for (const [id, o] of viewport.objects) {
    if (ids && !ids.includes(id)) continue
    if (!o.visible) continue
    box.expandByObject(o)
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
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      // The whole anchor counts as inside, so pressing the Camera button toggles the menu shut.
      const anchor = ref.current?.closest('.menu-anchor') ?? ref.current
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose])
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

/** Floating UI drawn over the 3D canvas: view info, selection actions and view tools. */
export function ViewportOverlay(): ReactNode {
  const selectedId = useStore((s) => s.selectedId)
  const selected = useStore((s) => s.objects.find((o) => o.id === s.selectedId))
  const { showGrid, snap, renderMode, fov, shot } = useStore((s) => s.settings)
  const effectsOn = useStore((s) => hasEffects(s.effects))
  const { setSettings, duplicateSelected, removeSelected } = useStore.getState()
  const [menu, setMenu] = useState(false)
  const closeMenu = useCallback(() => setMenu(false), [])

  return (
    <div className="overlay">
      <StartPanel />
      <div className="view-chip">
        {RENDER_MODES.find((m) => m.id === renderMode)?.label} · FOV {fov}°{effectsOn ? ' · Effects on' : ''}
      </div>

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

      <div className="float-bar view-bar">
        <div className="menu-anchor">
          <button className={`tool ${menu ? 'active' : ''}`} onClick={() => setMenu(!menu)} title="Camera angles">
            <Camera size={16} />
            Camera
          </button>
          {menu && <CameraMenu onClose={closeMenu} />}
        </div>
        <button
          className={`tool ${shot ? 'shot-set' : ''}`}
          onClick={() => (shot ? returnToShot() : saveShot())}
          title={shot ? 'Back to your saved view (C)' : 'Save the current view so you can return to it (C)'}
        >
          {shot ? <Clapperboard size={16} /> : <BookmarkPlus size={16} />}
          {shot ? 'Back to view' : 'Save view'}
        </button>
        <button
          className={`tool ${showGrid ? 'active' : ''}`}
          onClick={() => setSettings({ showGrid: !showGrid })}
          title="Show the ground grid (never exported)"
        >
          <Grid3x3 size={16} />
          Grid
        </button>
        <button
          className={`tool ${snap ? 'active' : ''}`}
          onClick={() => setSettings({ snap: !snap })}
          title="Snap to surfaces and corners while moving. Hold Shift to snap temporarily."
        >
          <Magnet size={16} />
          Snap <kbd>⇧</kbd>
        </button>
        <button
          className="tool"
          onClick={() => {
            const box = boundsOf()
            if (box) frame(box)
          }}
          title="Fit everything in view"
        >
          <Maximize size={16} />
          Frame all
        </button>
      </div>
    </div>
  )
}

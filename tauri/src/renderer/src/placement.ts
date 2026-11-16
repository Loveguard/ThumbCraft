import * as THREE from 'three'
import type { Vec3 } from './store'
import { viewport } from './components/Viewport'

export type PlaceStyle = 'ground' | 'floating' | 'grid'

/**
 * Where a newly added object should go: at the spot in the middle of the user's view.
 * - ground: stands on whatever the view centre hits, turned to face the camera (players, mobs)
 * - floating: a little above that spot, facing the camera (text, images, particles)
 * - grid: snapped to whole blocks without rotation (structures, schematics)
 */
export function placeNew(style: PlaceStyle, radius = 1): { position: Vec3; rotation: Vec3 } {
  const p = viewport.placement?.(radius)
  if (!p) return { position: [0, style === 'floating' ? 2 : 0, 0], rotation: [0, 0, 0] }
  const { x, y, z } = p.point
  switch (style) {
    case 'ground':
      return { position: [x, y, z], rotation: [0, p.faceCameraYaw, 0] }
    case 'floating':
      return { position: [x, y + 2, z], rotation: [0, p.faceCameraYaw, 0] }
    case 'grid':
      return { position: [Math.round(x), Math.round(y), Math.round(z)], rotation: [0, 0, 0] }
  }
}

export interface FrameSpot {
  /** Centre in the frame: -1…1 left→right and bottom→top. */
  screen: [number, number]
  /** Height as a share of the frame height. */
  height: number
  /** How tall the object is at scale 1 (world units). */
  unitHeight: number
  /** Distance in front of the camera (overlays are drawn on top, so this only sets the size). */
  depth?: number
}

/** Position, rotation (degrees) and scale that put a flat camera-facing object at a spot in the frame. */
export function frameTransform(
  eyeV: Vec3,
  targetV: Vec3,
  fov: number,
  aspect: number,
  spot: FrameSpot
): { position: Vec3; rotation: Vec3; scale: number } {
  const depth = spot.depth ?? 2
  const eye = new THREE.Vector3(...eyeV)
  const forward = new THREE.Vector3(...targetV).sub(eye).normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward)
  const halfH = depth * Math.tan(THREE.MathUtils.degToRad(fov / 2))
  const p = eye
    .addScaledVector(forward, depth)
    .addScaledVector(right, spot.screen[0] * halfH * aspect)
    .addScaledVector(up, spot.screen[1] * halfH)
  const e = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward.clone().negate()))
  )
  const deg = THREE.MathUtils.radToDeg
  return {
    position: [p.x, p.y, p.z],
    rotation: [deg(e.x), deg(e.y), deg(e.z)],
    scale: (spot.height * 2 * halfH) / spot.unitHeight
  }
}

import * as THREE from 'three'
import { viewport } from './Viewport'

const ray = new THREE.Raycaster()
const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()

function nearestOf(point: THREE.Vector3, candidates: THREE.Vector3[]): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null
  let bestD = Infinity
  for (const v of candidates) {
    const d = v.distanceTo(point)
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

/**
 * Where an object being dragged should snap to: the nearest vertex of the surface under the cursor
 * when one is close (corners of blocks, models, text), otherwise the exact point on that surface.
 * The dragged object itself is ignored.
 */
export function snapPoint(
  ndc: THREE.Vector2,
  camera: THREE.Camera | null,
  excludeId: string | null,
  vertexRadius = 0.35
): THREE.Vector3 | null {
  if (!camera) return null
  ray.setFromCamera(ndc, camera)
  const targets: THREE.Object3D[] = []
  for (const [id, o] of viewport.objects) if (id !== excludeId && o.visible) targets.push(o)
  const hit = ray.intersectObjects(targets, true).find((h) => {
    for (let p: THREE.Object3D | null = h.object; p; p = p.parent) if (!p.visible) return false
    return !!h.face
  })
  if (!hit || !hit.face) return null

  const mesh = hit.object as THREE.Mesh
  const pos = mesh.geometry?.getAttribute('position')
  const candidates: THREE.Vector3[] = []
  if (pos) {
    a.fromBufferAttribute(pos, hit.face.a).applyMatrix4(mesh.matrixWorld)
    b.fromBufferAttribute(pos, hit.face.b).applyMatrix4(mesh.matrixWorld)
    c.fromBufferAttribute(pos, hit.face.c).applyMatrix4(mesh.matrixWorld)
    candidates.push(a.clone(), b.clone(), c.clone())
  }
  // Terrain geometry is in block units, so its block corners are whole numbers in the mesh's own space.
  let isTerrain = false
  for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (p.name === 'terrain') isTerrain = true
  if (isTerrain) candidates.push(mesh.worldToLocal(hit.point.clone()).round().applyMatrix4(mesh.matrixWorld))
  const v = nearestOf(hit.point, candidates)
  if (v && v.distanceTo(hit.point) <= vertexRadius) return v.clone()
  return hit.point.clone()
}

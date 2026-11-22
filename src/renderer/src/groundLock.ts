// Keeps animated characters standing on what is really there. The floors come from the scene's own meshes (every
// upward-facing triangle of the terrain, builds and models), so slabs, stairs, carpets, turned or resized builds and
// imported models all count at their true height. Each frame the character's lower vertices are checked against
// them: anything sunk into the ground lifts the whole character out, and a walker hovering over a lower step is
// set down onto it.
import * as THREE from 'three'

/** How deep a vertex may be under a floor and still count as sunk into it (deeper is a wall or a riser). */
const MAX_SINK = 0.45
/** Only this much of a character (from its feet, in blocks at scale 1) is checked against the ground. */
const LOWER_PART = 0.75

interface Field {
  /** Upward triangles in world space, nine numbers each. */
  tris: Float32Array
  /** Triangles by block column. */
  cells: Map<number, number[]>
  matrix: THREE.Matrix4
  geometry: THREE.BufferGeometry
  version: number
}

const cellKey = (x: number, z: number): number => (Math.floor(x) + 32768) * 65536 + (Math.floor(z) + 32768)

const fields = new WeakMap<THREE.Mesh, Field>()

/** The upward triangles of one mesh, kept until the mesh moves or its geometry changes. */
function fieldOf(mesh: THREE.Mesh): Field | null {
  const g = mesh.geometry
  const pos = g?.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return null
  const version = (pos.version ?? 0) + (g.index?.version ?? 0)
  const known = fields.get(mesh)
  if (known && known.geometry === g && known.version === version && known.matrix.equals(mesh.matrixWorld)) return known
  const index = g.index
  const count = index ? index.count : pos.count
  const out: number[] = []
  const cells = new Map<number, number[]>()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i
    const ib = index ? index.getX(i + 1) : i + 1
    const ic = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld)
    b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld)
    c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld)
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a))
    const len = n.length()
    // Faces that point up are something to stand on (the undersides of things above are not).
    if (len < 1e-9 || n.y / len < 0.5) continue
    const id = out.length / 9
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    const x0 = Math.floor(Math.min(a.x, b.x, c.x))
    const x1 = Math.floor(Math.max(a.x, b.x, c.x) - 1e-6)
    const z0 = Math.floor(Math.min(a.z, b.z, c.z))
    const z1 = Math.floor(Math.max(a.z, b.z, c.z) - 1e-6)
    // A huge ground plane would fill millions of cells; anything past this is left to its neighbours.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue
    for (let x = x0; x <= Math.max(x0, x1); x++)
      for (let z = z0; z <= Math.max(z0, z1); z++) {
        const k = cellKey(x, z)
        const list = cells.get(k)
        if (list) list.push(id)
        else cells.set(k, [id])
      }
  }
  const field: Field = { tris: new Float32Array(out), cells, matrix: mesh.matrixWorld.clone(), geometry: g, version }
  fields.set(mesh, field)
  return field
}

/** The meshes of things to stand on, skipping helpers, hidden parts and the see-through layer (water, glass). */
function floorMeshes(targets: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  for (const root of targets) {
    if (!root.visible) continue
    root.updateMatrixWorld()
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || m.renderOrder === 1) return
      for (let p: THREE.Object3D | null = m; p && p !== root.parent; p = p.parent)
        if (!p.visible || p.userData.helper) return
      out.push(m)
    })
  }
  return out
}

/** Finds the floor under a point: the highest upward surface at (x, z) no higher than `from`. */
export type FloorFn = (x: number, z: number, from: number) => number | null

export function makeFloor(targets: THREE.Object3D[]): FloorFn | null {
  const list = floorMeshes(targets)
    .map(fieldOf)
    .filter((f): f is Field => !!f && f.tris.length > 0)
  if (!list.length) return null
  return (x, z, from) => {
    let best: number | null = null
    const k = cellKey(x, z)
    for (const f of list) {
      const ids = f.cells.get(k)
      if (!ids) continue
      const t = f.tris
      for (const id of ids) {
        const o = id * 9
        const ax = t[o]
        const az = t[o + 2]
        const v0x = t[o + 3] - ax
        const v0z = t[o + 5] - az
        const v1x = t[o + 6] - ax
        const v1z = t[o + 8] - az
        const px = x - ax
        const pz = z - az
        const den = v0x * v1z - v1x * v0z
        if (Math.abs(den) < 1e-12) continue
        const u = (px * v1z - v1x * pz) / den
        const v = (v0x * pz - px * v0z) / den
        if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue
        const y = t[o + 1] + u * (t[o + 4] - t[o + 1]) + v * (t[o + 7] - t[o + 1])
        if (y <= from + 1e-4 && (best === null || y > best)) best = y
      }
    }
    return best
  }
}

const v = new THREE.Vector3()

/** The world-space vertices of a character's body (not what it holds or wears on top), as x, y, z triples. */
function bodyVertices(model: THREE.Object3D, out: number[]): void {
  out.length = 0
  model.updateWorldMatrix(true, true)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.visible) return
    for (let p: THREE.Object3D | null = m; p && p !== model; p = p.parent) if (p.userData.equipment) return
    const pos = m.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh) : null
    for (let i = 0; i < pos.count; i++) {
      if (skinned) skinned.getVertexPosition(i, v)
      else v.fromBufferAttribute(pos, i)
      v.applyMatrix4(m.matrixWorld)
      out.push(v.x, v.y, v.z)
    }
  })
}

export interface Contact {
  /** How far the deepest vertex has sunk into the ground (0 when none has). */
  sink: number
  /** How far the lowest vertex floats over the ground under it (Infinity over a drop or nothing). */
  gap: number
}

const verts: number[] = []

/** How a character meets the ground: `base` is its feet's height, `scale` its size. */
export function contactOf(model: THREE.Object3D, floor: FloorFn, base: number, scale: number): Contact {
  bodyVertices(model, verts)
  const top = base + LOWER_PART * scale
  let sink = 0
  let gap = Infinity
  // Neighbouring vertices mostly share a column: look each column and height band up once.
  const memo = new Map<string, number | null>()
  for (let i = 0; i < verts.length; i += 3) {
    const y = verts[i + 1]
    if (y > top) continue
    const x = verts[i]
    const z = verts[i + 2]
    const key = `${Math.round(x * 16)},${Math.round(z * 16)},${Math.round(y * 16)}`
    let f = memo.get(key)
    if (f === undefined) memo.set(key, (f = floor(x, z, y + MAX_SINK)))
    if (f === null) continue
    if (f > y) sink = Math.max(sink, f - y)
    else gap = Math.min(gap, y - f)
  }
  return { sink, gap }
}

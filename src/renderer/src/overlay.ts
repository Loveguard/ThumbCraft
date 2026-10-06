// "Always on top" and "Flat lighting" for 3D objects (players, mobs, builds, 3D text, models, effects).
//
// On top: the object's meshes are drawn last, after the depth buffer is cleared, so nothing in the scene can
// hide them (a tree in front of a title) while the object still hides its own back faces correctly.
// Flat lighting: the object's materials are swapped for unlit ones, so it shows its true colours evenly,
// whatever lights and shadows are around it.
import * as THREE from 'three'

/** Draw order of on-top objects: above the scene's own transparent layers (water renders at 1). */
export const OVERLAY_ORDER = 1000

interface Original {
  material: THREE.Material | THREE.Material[]
  renderOrder: number
  receiveShadow: boolean
  onBeforeRender: THREE.Object3D['onBeforeRender']
}
const originals = new WeakMap<THREE.Mesh, Original>()
/** The settings and material each mesh was last converted with. */
const applied = new WeakMap<THREE.Mesh, { key: string; material: THREE.Mesh['material'] }>()

/** The depth buffer is cleared once per render, just before the first on-top mesh is drawn. */
let clearedFrame = -1
function clearDepthOnce(renderer: THREE.WebGLRenderer): void {
  if (renderer.info.render.frame === clearedFrame) return
  clearedFrame = renderer.info.render.frame
  renderer.clearDepth()
}

/** The same look without lighting: colour, texture, vertex colours and cut-outs, but no shading. */
function unlit(m: THREE.Material): THREE.Material {
  const src = m as THREE.MeshLambertMaterial
  if (!('map' in src) || m instanceof THREE.ShaderMaterial) return own(m)
  const b = new THREE.MeshBasicMaterial({
    map: src.map,
    alphaMap: src.alphaMap,
    color: src.color,
    vertexColors: src.vertexColors,
    side: src.side,
    alphaTest: src.alphaTest,
    opacity: src.opacity,
    transparent: src.transparent
  })
  b.name = m.name
  return b
}

/** A private copy of a (possibly shared) material, keeping its shader patches and live uniforms. */
function own(m: THREE.Material): THREE.Material {
  const c = m.clone()
  c.onBeforeCompile = m.onBeforeCompile
  c.customProgramCacheKey = m.customProgramCacheKey
  if (m instanceof THREE.ShaderMaterial) (c as THREE.ShaderMaterial).uniforms = m.uniforms
  return c
}

function restore(mesh: THREE.Mesh): void {
  const o = originals.get(mesh)
  if (!o) return
  const current = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const before = Array.isArray(o.material) ? o.material : [o.material]
  for (const m of current) if (!before.includes(m)) m.dispose()
  mesh.material = o.material
  mesh.renderOrder = o.renderOrder
  mesh.receiveShadow = o.receiveShadow
  mesh.onBeforeRender = o.onBeforeRender
  originals.delete(mesh)
  applied.delete(mesh)
}

function apply(mesh: THREE.Mesh, onTop: boolean, flat: boolean, order: number): void {
  restore(mesh)
  originals.set(mesh, {
    material: mesh.material,
    renderOrder: mesh.renderOrder,
    receiveShadow: mesh.receiveShadow,
    onBeforeRender: mesh.onBeforeRender
  })
  const convert = (m: THREE.Material): THREE.Material => {
    const c = flat ? unlit(m) : own(m)
    if (onTop) {
      // Transparent materials are drawn after every opaque one, ordered by renderOrder first.
      c.transparent = true
      c.depthTest = true
      c.depthWrite = true
    }
    return c
  }
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
  if (flat) mesh.receiveShadow = false
  if (onTop) {
    mesh.renderOrder = OVERLAY_ORDER + order
    const before = mesh.onBeforeRender
    mesh.onBeforeRender = function (renderer, ...rest) {
      clearDepthOnce(renderer)
      before.call(this, renderer, ...rest)
    }
  }
  applied.set(mesh, { key: `${onTop}|${flat}|${order}`, material: mesh.material })
}

/** Brings every mesh under `root` in line with the settings (new meshes from async loads included). */
export function syncOverlay(root: THREE.Object3D, onTop: boolean, flat: boolean, order: number): void {
  const key = `${onTop}|${flat}|${order}`
  const walk = (o: THREE.Object3D): void => {
    if (o.userData.helper) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
      const done = applied.get(mesh)
      // The object swapped in a new material itself (a new skin, a texture variant): that's the original now.
      const original = originals.get(mesh)
      if (done && original && done.material !== mesh.material) {
        original.material = mesh.material
        mesh.material = done.material // so restore() finds and frees only our copies
        applied.delete(mesh)
      }
      if (!(onTop || flat)) restore(mesh)
      else if (applied.get(mesh)?.key !== key) apply(mesh, onTop, flat, order)
    }
    for (const c of o.children) walk(c)
  }
  walk(root)
}

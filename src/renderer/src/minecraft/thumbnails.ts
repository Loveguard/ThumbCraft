// Small isometric preview images of models (mobs, structure pieces), rendered off screen one at a time and cached.
import * as THREE from 'three'
import type { MobModels } from '@shared/minecraft/entityModels'
import type { AssetContext } from './assets'
import { buildTerrain } from './builders'
import { buildMob } from './mobs'

const SIZE = 160
let renderer: THREE.WebGLRenderer | null = null
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Promise<string | null>>()

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  return renderer
}

/** Renders an object from the front-right, a little above, framed to fit; returns a PNG data URL. */
export function renderThumbnail(object: THREE.Object3D): string {
  const r = getRenderer()
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight('#ffffff', 1.4))
  const sun = new THREE.DirectionalLight('#ffffff', 1.6)
  sun.position.set(2, 4, 3)
  scene.add(sun)
  scene.add(object)
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const centre = box.getCenter(new THREE.Vector3())
  const radius = Math.max(0.01, box.getSize(new THREE.Vector3()).length() / 2)
  const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 10)
  cam.position.copy(centre).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(radius * 4))
  cam.lookAt(centre)
  r.setClearColor(0x000000, 0)
  r.render(scene, cam)
  scene.remove(object)
  return r.domElement.toDataURL('image/png')
}

function dispose(o: THREE.Object3D): void {
  o.traverse((x) => {
    const m = x as THREE.Mesh
    if (m.isMesh) m.geometry.dispose()
  })
}

/** Cached preview of a mob layer with its default texture (null when it can't be drawn). */
export function mobThumbnail(models: MobModels, layerKey: string, texture: string): Promise<string | null> {
  const key = `${models.version}|${layerKey}|${texture}`
  let p = cache.get(key)
  if (!p) {
    // One at a time: a long list of icons shouldn't stall the main viewport.
    p = queue.then(async () => {
      const layer = models.layers[layerKey]
      if (!layer) return null
      try {
        const mob = await buildMob(layer, texture)
        const url = renderThumbnail(mob)
        dispose(mob)
        return url
      } catch {
        return null
      }
    })
    queue = p.catch(() => null)
    cache.set(key, p)
  }
  return p
}

/** Cached isometric preview of one of the game's structure pieces (null when it can't be drawn). */
export function structureThumbnail(ctx: AssetContext, id: string): Promise<string | null> {
  const key = `${ctx.bundle.version}|structure|${id}`
  let p = cache.get(key)
  if (!p) {
    p = queue.then(async () => {
      try {
        const t = await window.blockframe.loadStructure(id)
        const group = await buildTerrain(ctx, t, { ambientOcclusion: true, cinematic: false })
        if (!group.children.length) return null
        const url = renderThumbnail(group)
        dispose(group)
        return url
      } catch {
        return null
      }
    })
    queue = p.catch(() => null)
    cache.set(key, p)
  }
  return p
}

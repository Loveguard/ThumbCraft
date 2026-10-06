// Imported 3D models (.glb, .gltf, .obj with optional .mtl). Companion files (buffers, textures) are matched by
// file name, so a model made in Blockbench or Blender comes in with its textures.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { MediaEntry } from '../media'

export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj']
export const isModelFile = (name: string): boolean => MODEL_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e))

const base = (url: string): string => decodeURIComponent(url.split(/[\\/]/).pop() ?? url).toLowerCase()

/** Loads a model, sitting on the origin (bottom centre), with shadows on. Pixel-art textures stay crisp. */
export async function loadModel(main: MediaEntry, extras: MediaEntry[]): Promise<THREE.Object3D> {
  const byName = new Map(extras.map((m) => [m.name.toLowerCase(), m.url]))
  const manager = new THREE.LoadingManager()
  // Relative paths (e.g. "textures/crate.png" from an .mtl) resolve against the blob URL, so match by file name.
  // Anything else (an absolute file:// path inside the model, say) is never loaded.
  manager.setURLModifier((url) => byName.get(base(url)) ?? (/^(blob:|data:)/.test(url) ? url : 'data:,'))

  const name = main.name.toLowerCase()
  let object: THREE.Object3D
  if (name.endsWith('.obj')) {
    const loader = new OBJLoader(manager)
    const mtl = extras.find((m) => m.name.toLowerCase().endsWith('.mtl'))
    if (mtl) {
      const materials = await new MTLLoader(manager).loadAsync(mtl.url)
      materials.preload()
      loader.setMaterials(materials)
    }
    object = await loader.loadAsync(main.url)
  } else {
    object = (await new GLTFLoader(manager).loadAsync(main.url)).scene
  }

  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (mat as THREE.MeshStandardMaterial).map
      // Small textures are almost always pixel art (Blockbench exports): keep them sharp like the game.
      if (map?.image && (map.image as { width: number }).width <= 256) {
        map.magFilter = THREE.NearestFilter
        map.minFilter = THREE.NearestFilter
        map.generateMipmaps = false
        map.needsUpdate = true
      }
    }
  })

  const box = new THREE.Box3().setFromObject(object)
  const centre = box.getCenter(new THREE.Vector3())
  object.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z))
  const root = new THREE.Group()
  root.add(object)
  root.userData.size = box.getSize(new THREE.Vector3()).toArray()
  return root
}

/** A sensible starting scale: keep real-world-sized models as they are, fit tiny or huge ones to ~2 blocks. */
export function fitScale(size: number[]): number {
  const max = Math.max(...size)
  if (!isFinite(max) || max <= 0) return 1
  return max < 0.3 || max > 30 ? 2 / max : 1
}

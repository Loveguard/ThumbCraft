// three.js builders for mob models exported from the game (see src/shared/minecraft/entityModels.ts).
import * as THREE from 'three'
import type { DumpedLayer, DumpedPart, MobModels } from '@shared/minecraft/entityModels'
import { assetUrl } from './assets'

let modelsPromise: Promise<MobModels> | null = null

/** Loads (and on first use, exports) every mob model for the current Minecraft version. */
export function mobModels(): Promise<MobModels> {
  modelsPromise ??= window.blockframe.loadMobModels().catch((e) => {
    modelsPromise = null
    throw e
  })
  return modelsPromise
}

function partGeometry(part: DumpedPart): THREE.BufferGeometry | null {
  if (!part.quads.length) return null
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const q of part.quads) {
    const base = pos.length / 3
    for (const [x, y, z, u, v] of q.v) {
      pos.push(x, y, z)
      nrm.push(...q.n)
      uv.push(u, 1 - v)
    }
    for (let i = 1; i + 1 < q.v.length; i++) idx.push(base, base + i, base + i + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

function buildPart(part: DumpedPart, path: string, material: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  g.name = path
  g.position.set(...part.pivot)
  g.rotation.order = 'ZYX' // vanilla ModelPart: rotationZYX(zRot, yRot, xRot)
  g.rotation.set(...part.rot)
  g.scale.set(...part.scale)
  g.visible = part.visible
  g.userData.baseRot = part.rot
  g.userData.mobPart = true
  const geo = partGeometry(part)
  if (geo) {
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = true
    g.add(mesh)
  }
  for (const [name, child] of Object.entries(part.children))
    g.add(buildPart(child, path ? `${path}/${name}` : name, material))
  return g
}

/**
 * Builds a mob the way LivingEntityRenderer places it: model space is in pixels with Y pointing down,
 * flipped by scale(-1,-1,1), turned 180° and lifted 1.501 blocks, so the feet rest on y=0.
 */
export async function buildMob(layer: DumpedLayer, texture: string): Promise<THREE.Group> {
  const tex = await new THREE.TextureLoader().loadAsync(assetUrl(texture))
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide })
  const wrapper = new THREE.Group()
  wrapper.name = 'mob'
  wrapper.position.y = 1.501
  wrapper.scale.set(1 / 16, -1 / 16, -1 / 16)
  wrapper.add(buildPart(layer.root, '', material))
  return wrapper
}

export function applyMobPose(mob: THREE.Object3D, offsets: Record<string, [number, number, number]>): void {
  mob.traverse((o) => {
    if (!o.userData.mobPart || !o.name) return
    const base = o.userData.baseRot as [number, number, number]
    const off = offsets[o.name] ?? [0, 0, 0]
    const d = THREE.MathUtils.degToRad
    o.rotation.set(base[0] + d(off[0]), base[1] + d(off[1]), base[2] + d(off[2]))
  })
}

// Chests and signs inside terrain and builds, drawn with the game's own entity models (see
// src/shared/minecraft/blockEntities.ts for how each is placed in its block).
import * as THREE from 'three'
import { blockEntityKind, blockEntityPlan } from '@shared/minecraft/blockEntities'
import type { TerrainData } from '@shared/types'
import { buildPart, entityMaterial, mobModels } from './mobs'

/** Whether a terrain holds any chest or sign (cheap: only its palette is looked at). */
export const hasBlockEntities = (t: TerrainData): boolean => t.palette.some((b) => blockEntityKind(b.name))

/**
 * Every chest and sign in a terrain, positioned in the terrain's block space (origin at its minimum corner).
 * Null when there are none, or when the game's models can't be loaded (they are then simply left out).
 */
export async function buildBlockEntities(t: TerrainData): Promise<THREE.Group | null> {
  const plans = t.palette.map((b) => blockEntityPlan(b.name, b.properties))
  if (!plans.some(Boolean)) return null
  let models
  try {
    models = await mobModels()
  } catch {
    return null
  }
  const materials = new Map<string, Promise<THREE.Material | null>>()
  const material = (texture: string): Promise<THREE.Material | null> => {
    let m = materials.get(texture)
    if (!m) materials.set(texture, (m = entityMaterial(texture).catch(() => null)))
    return m
  }
  // One model per palette entry, cloned for every block that uses it (the geometry is shared).
  const templates = await Promise.all(
    plans.map(async (plan) => {
      if (!plan) return null
      const key = plan.layers.find((k) => models.layers[k])
      const texture = plan.textures.find((p) => models.textureSizes[p])
      const mat = texture ? await material(texture) : null
      if (!key || !mat) return null
      const g = new THREE.Group()
      g.add(buildPart(models.layers[key].root, '', mat))
      g.matrixAutoUpdate = false
      g.userData.local = new THREE.Matrix4().fromArray(plan.matrix)
      return g
    })
  )
  if (!templates.some(Boolean)) return null
  const out = new THREE.Group()
  out.name = 'block-entities'
  const { sizeX, sizeY, sizeZ, blocks } = t
  for (let y = 0; y < sizeY; y++)
    for (let z = 0; z < sizeZ; z++)
      for (let x = 0; x < sizeX; x++) {
        const tpl = templates[blocks[x + z * sizeX + y * sizeX * sizeZ]]
        if (!tpl) continue
        const g = tpl.clone()
        g.matrix.makeTranslation(x, y, z).multiply(tpl.userData.local as THREE.Matrix4)
        out.add(g)
      }
  out.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return out
}

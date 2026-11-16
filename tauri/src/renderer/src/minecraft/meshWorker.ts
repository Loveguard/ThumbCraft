// Meshes terrain off the main thread, so the editor stays responsive while a big area is built.
import { ModelResolver } from '@shared/minecraft/blockModel'
import { meshTerrain, LAYERS, type MeshOptions, type TextureSlot } from '@shared/minecraft/mesher'
import type { Colormaps } from '@shared/minecraft/tints'
import type { BiomeInfo, TerrainData } from '@shared/types'

export interface MeshRequest {
  id: number
  /** Sent when the loaded game (or its resource packs) changed since the last request. */
  models?: { blockstates: Record<string, unknown>; models: Record<string, unknown> }
  terrain: TerrainData
  slots: [string, TextureSlot][]
  biomes: Record<string, BiomeInfo>
  colormaps: Colormaps
  opts: MeshOptions
}

let resolver: ModelResolver | null = null

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const { id, models, terrain, slots, biomes, colormaps, opts } = e.data
  try {
    if (models) resolver = new ModelResolver(models.blockstates, models.models)
    if (!resolver) throw new Error('No block models yet')
    const before = new Set(resolver.failed)
    const map = new Map(slots)
    const mesh = meshTerrain(terrain, resolver, (n) => map.get(n) ?? null, biomes, colormaps, opts)
    const buffers = [...LAYERS.map((l) => mesh[l]), mesh.waterSurface].flatMap((b) =>
      Object.values(b).map((a) => (a as Float32Array).buffer)
    )
    const failed = [...resolver.failed].filter((f) => !before.has(f))
    ;(self as unknown as Worker).postMessage({ id, mesh, failed }, buffers)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: (err as Error).message })
  }
}

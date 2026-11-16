import { BACKDROP_GROUND, BACKDROPS, buildBackdrop, type BackdropId } from '@shared/minecraft/backdrops'
import type { TerrainData } from '@shared/types'
import { newId, terrainStore, useStore, type Vec3 } from './store'

/** Height (in blocks) of the top of the centre column, so the ground under the camera sits at y=0. */
function centreSurface(t: TerrainData): number {
  const cx = Math.floor(t.sizeX / 2)
  const cz = Math.floor(t.sizeZ / 2)
  for (let y = t.sizeY - 1; y >= 0; y--) if (t.blocks[cx + cz * t.sizeX + y * t.sizeX * t.sizeZ] !== 0) return y + 1
  return 0
}

/**
 * Adds a block volume to the scene. Without a position, generated landscapes are lowered so their
 * centre surface sits at y=0; builds pass the spot the user is looking at.
 */
export function addTerrain(t: TerrainData, name: string, position?: Vec3, ground = false, groupId?: string): void {
  const terrainId = newId('terrain')
  terrainStore.set(terrainId, t)
  useStore.getState().add({
    id: newId('obj'),
    kind: 'terrain',
    name,
    terrainId,
    ...(ground && { ground: true }),
    ...(groupId && { groupId }),
    visible: true,
    position: position ?? [0, -centreSurface(t), 0],
    rotation: [0, 0, 0],
    scale: 1
  })
}

/**
 * Makes `t` the scene's landscape: any previous ground (ready-made or generated biome, imported world) is
 * replaced, so the user can swap biomes at any point without stacking landscapes. Builds stay.
 */
export function setGround(t: TerrainData, name: string, position?: Vec3): void {
  const s = useStore.getState()
  for (const o of s.objects) if (o.kind === 'terrain' && o.ground) s.remove(o.id)
  addTerrain(t, name, position, true)
}

/** Swaps in one of the ready-made (pre-generated) biomes; instant, no Java or world generation. */
export function applyReadyMadeBiome(id: BackdropId): void {
  const name = BACKDROPS.find((b) => b.id === id)?.name ?? id
  // The backdrop's centre ground sits at y=0, where players stand.
  setGround(buildBackdrop(id), `${name} (ready-made)`, [0, -(BACKDROP_GROUND + 1), 0])
}

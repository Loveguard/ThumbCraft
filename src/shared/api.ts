// The API the preload script exposes to the renderer as `window.blockframe`.
import type { MobModels } from './minecraft/entityModels'
import type {
  AssetBundle,
  GenerateProgress,
  GenerateRequest,
  Dimension,
  SkinResult,
  TerrainData,
  WorldImportRequest
} from './types'

export interface JavaInfo {
  path: string
  version: string
  /** Whether it is new enough for the loaded Minecraft version. */
  enough?: boolean
  /** The Java version that Minecraft version needs. */
  need?: number
}

export interface RecentProject {
  id: string
  name: string
  savedPath: string | null
  updatedAt: number
  minecraftVersion: string | null
  /** PNG data URL */
  thumbnail: string | null
}

export interface ProjectMeta {
  id: string
  name: string
  minecraftVersion: string | null
  savedPath: string | null
  thumbnail: string | null
}

export interface BlockFrameApi {
  /** Loads the newest Minecraft installed on this computer; null when none is found. */
  loadNewest(): Promise<AssetBundle | null>
  pickJar(): Promise<string | null>
  pickWorldFolder(): Promise<string | null>
  /** Loads assets from a client jar; textures are then served at mcasset://textures/<path>.png */
  loadJar(jarPath: string): Promise<AssetBundle>
  findJava(): Promise<JavaInfo | null>
  /** Downloads a Java runtime the loaded version can use (into the app's own folder). */
  installJava(): Promise<JavaInfo | null>
  onJavaProgress(cb: (message: string) => void): () => void
  /** Downloads the latest client jar from Mojang; returns its path (ready for loadJar). */
  downloadClient(): Promise<string>
  onClientProgress(cb: (message: string) => void): () => void
  fetchSkin(username: string): Promise<SkinResult>
  generateTerrain(req: GenerateRequest & { acceptEula: boolean }): Promise<TerrainData>
  /** Stops the generation in progress (it rejects with "Generation cancelled"). */
  cancelGeneration(): Promise<void>
  /** Starts generating a picked biome in the background so Generate is quick (blank seed). */
  prefetchBiome(version: string, dimension: Dimension, biome: string, size: number): Promise<void>
  /** Starts the world generator in the background and pre-generates popular biomes (needs EULA accepted). */
  prewarmGenerator(version: string, biomes: string[], size: number): Promise<void>
  importWorld(req: WorldImportRequest): Promise<TerrainData>
  onGenerateProgress(cb: (p: GenerateProgress) => void): () => void
  savePng(dataUrl: string, suggestedName: string): Promise<string | null>
  /** Asks for a folder once and writes every image into it. Returns the folder, or null if cancelled. */
  savePngs(images: { name: string; dataUrl: string }[]): Promise<string | null>
  /** A vanilla structure template from the loaded jar. */
  loadStructure(id: string): Promise<TerrainData>
  /** Opens a file picker for .schem / .litematic / .nbt and converts the chosen file. Null if cancelled. */
  importSchematic(): Promise<{ name: string; terrain: TerrainData } | null>
  eulaAccepted(): Promise<boolean>
  /** Records that the user accepted the Minecraft EULA (lets the generator warm up early). */
  acceptEula(): Promise<void>
  /** Mob models exported from the loaded client (slow the first time, cached afterwards). */
  loadMobModels(): Promise<MobModels>
  onMobProgress(cb: (line: string) => void): () => void
  /** Save to `path`, or ask where when null. Returns the saved path, or null if cancelled. */
  saveProject(bytes: Uint8Array, path: string | null, meta: ProjectMeta): Promise<string | null>
  autosaveProject(bytes: Uint8Array, meta: ProjectMeta): Promise<void>
  openProject(): Promise<{ bytes: Uint8Array; path: string } | null>
  recentProjects(): Promise<RecentProject[]>
  openRecent(id: string): Promise<{ bytes: Uint8Array; path: string | null }>
  forgetRecent(id: string): Promise<void>
  /** Called when the window is closing; resolve once the recovery copy is written. */
  /** A newer ThumbCraft: ready = downloaded and installed on quit (Windows); otherwise a download link. */
  onUpdate(cb: (u: { version: string; ready: boolean; url: string }) => void): () => void
  onFlushRequest(cb: () => Promise<void>): () => void
  /** Picks a sky image; returns its bytes. */
}

declare global {
  interface Window {
    blockframe: BlockFrameApi
  }
}

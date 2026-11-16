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

/** A font installed on this computer (one face of a family). */
export interface SystemFont {
  family: string
  style: string
  full: string
  path: string
  /** Which font of a .ttc collection. */
  index: number
}

/** A resource pack in the pack list (top pack first). */
export interface ResourcePackInfo {
  path: string
  name: string
  description: string
  /** pack.png as a data URL. */
  icon: string | null
  enabled: boolean
  /** The file or folder is gone (or unreadable). */
  missing: boolean
  /** How many textures it replaces. */
  textures: number
}

/** The kinds of file animation sharing deals in. */
export type DataFileKind = 'presets' | 'blockbench' | 'audio' | 'glb'

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
  /** Asks where to save a layered Photoshop file. Returns the path, or null if cancelled. */
  savePsd(bytes: Uint8Array, suggestedName: string): Promise<string | null>
  /** Asks where to save a video, GIF or zip of frames (before rendering it); null when cancelled. */
  chooseVideoFile(suggestedName: string, ext: 'mp4' | 'webm' | 'gif' | 'zip'): Promise<string | null>
  /** Writes the rendered video to the file just chosen. */
  writeVideo(bytes: Uint8Array): Promise<string>
  /** Asks where to save a file of this kind (preset packs, Blockbench animations, glTF models); null if cancelled. */
  saveDataFile(bytes: Uint8Array, suggestedName: string, kind: DataFileKind): Promise<string | null>
  /** Asks for a file of this kind to open (preset packs, Blockbench animations, sound); null if cancelled. */
  openDataFile(kind: DataFileKind): Promise<{ name: string; bytes: Uint8Array } | null>
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
  /** Claude asks the window to do something (see main/claude.ts); resolve with the result. */
  onClaudeRequest(cb: (method: string, params: Record<string, unknown>) => Promise<unknown>): () => void
  listResourcePacks(): Promise<ResourcePackInfo[]>
  /** Asks for pack .zip files (or a folder) and adds them on top. Returns the new list. */
  addResourcePacks(folder: boolean): Promise<ResourcePackInfo[]>
  /** Saves the order and on/off state (top first) and reloads the assets with them. */
  setResourcePacks(list: { path: string; enabled: boolean }[]): Promise<AssetBundle | null>
  /** Fonts installed on this computer. */
  listSystemFonts(): Promise<SystemFont[]>
  /** A listed font's file, ready to embed (collections are split into a single font). */
  readSystemFont(path: string, index: number): Promise<Uint8Array>
  /** Picks a sky image; returns its bytes. */
}

declare global {
  interface Window {
    blockframe: BlockFrameApi
  }
}

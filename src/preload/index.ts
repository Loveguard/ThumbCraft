import { contextBridge, ipcRenderer } from 'electron'
import type { BlockFrameApi } from '@shared/api'
import type { GenerateProgress } from '@shared/types'

const api: BlockFrameApi = {
  loadNewest: () => ipcRenderer.invoke('mc:loadNewest'),
  pickJar: () => ipcRenderer.invoke('mc:pickJar'),
  pickWorldFolder: () => ipcRenderer.invoke('mc:pickWorld'),
  loadJar: (jarPath) => ipcRenderer.invoke('mc:loadJar', jarPath),
  findJava: () => ipcRenderer.invoke('mc:findJava'),
  installJava: () => ipcRenderer.invoke('java:install'),
  onJavaProgress: (cb) => {
    const listener = (_e: unknown, m: string): void => cb(m)
    ipcRenderer.on('java:progress', listener)
    return () => ipcRenderer.removeListener('java:progress', listener)
  },
  downloadClient: () => ipcRenderer.invoke('mc:downloadClient'),
  onClientProgress: (cb) => {
    const listener = (_e: unknown, m: string): void => cb(m)
    ipcRenderer.on('mc:clientProgress', listener)
    return () => ipcRenderer.removeListener('mc:clientProgress', listener)
  },
  fetchSkin: (username) => ipcRenderer.invoke('skin:fetch', username),
  generateTerrain: (req) => ipcRenderer.invoke('terrain:generate', req),
  cancelGeneration: () => ipcRenderer.invoke('terrain:cancel'),
  prefetchBiome: (version, dimension, biome, size) =>
    ipcRenderer.invoke('terrain:prefetch', version, dimension, biome, size),
  prewarmGenerator: (version, biomes, size) => ipcRenderer.invoke('terrain:prewarm', version, biomes, size),
  importWorld: (req) => ipcRenderer.invoke('terrain:import', req),
  onGenerateProgress: (cb) => {
    const listener = (_e: unknown, p: GenerateProgress): void => cb(p)
    ipcRenderer.on('terrain:progress', listener)
    return () => ipcRenderer.removeListener('terrain:progress', listener)
  },
  savePng: (dataUrl, name) => ipcRenderer.invoke('file:savePng', dataUrl, name),
  savePngs: (images) => ipcRenderer.invoke('file:savePngs', images),
  eulaAccepted: () => ipcRenderer.invoke('mc:eulaAccepted'),
  acceptEula: () => ipcRenderer.invoke('mc:acceptEula'),
  loadStructure: (id) => ipcRenderer.invoke('structure:load', id),
  importSchematic: () => ipcRenderer.invoke('schematic:import'),
  loadMobModels: () => ipcRenderer.invoke('mobs:load'),
  onMobProgress: (cb) => {
    const listener = (_e: unknown, line: string): void => cb(line)
    ipcRenderer.on('mobs:progress', listener)
    return () => ipcRenderer.removeListener('mobs:progress', listener)
  },
  saveProject: (bytes, path, meta) => ipcRenderer.invoke('project:save', bytes, path, meta),
  autosaveProject: (bytes, meta) => ipcRenderer.invoke('project:autosave', bytes, meta),
  openProject: () => ipcRenderer.invoke('project:open'),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  openRecent: (id) => ipcRenderer.invoke('project:openRecent', id),
  forgetRecent: (id) => ipcRenderer.invoke('project:forget', id),
  onUpdate: (cb) => {
    const listener = (_e: unknown, u: { version: string; ready: boolean; url: string }): void => cb(u)
    ipcRenderer.on('app:update', listener)
    return () => ipcRenderer.removeListener('app:update', listener)
  },
  onFlushRequest: (cb) => {
    const listener = (): void => void cb().finally(() => ipcRenderer.send('app:flushed'))
    ipcRenderer.on('app:flush', listener)
    return () => ipcRenderer.removeListener('app:flush', listener)
  }
}

contextBridge.exposeInMainWorld('blockframe', api)

import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { gunzipCapped } from '@shared/minecraft/inflate'
import { parseNbt } from '@shared/minecraft/nbt'
import { readSchematic, structureToTerrain } from '@shared/minecraft/schematics'
import type { Dimension, GenerateRequest, WorldImportRequest } from '@shared/types'
import { cacheDir, currentVersion, loadJar, newestJars, readAsset, readStructure } from './assets'
import { installJava } from './javaInstall'
import { loadMobModels, stopMobExport } from './mobs'
import {
  autosave,
  forgetRecent,
  imageBytes,
  openProjectDialog,
  readRecent,
  recentProjects,
  saveProject
} from './projects'
import type { ProjectMeta } from '@shared/api'
import { downloadLatestClient, fetchSkin } from './mojang'
import {
  findJava,
  generateTerrain,
  importWorld,
  prefetchBiome,
  prewarmGenerator,
  requiredJava,
  rescanJava,
  shutdownGenerator
} from './generator'
import { readSettings, updateSettings } from './settings'
import { checkForUpdates } from './updates'

// Textures from the loaded client jar are served as mcasset://textures/block/stone.png
// The app was called BlockFrame, then ThumbCrafter; keep using an older data folder (settings, recovery
// copies, the generator cache) when one exists, instead of starting over under the new name.
if (!existsSync(app.getPath('userData'))) {
  const legacy = ['ThumbCrafter', 'BlockFrame'].map((n) => join(app.getPath('appData'), n)).find(existsSync)
  if (legacy) app.setPath('userData', legacy)
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'mcasset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  // The on-device background remover's runtime and model (the page itself is file://, which can't fetch).
  { scheme: 'tcres', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

/** Files served on tcres://mediapipe/<name>; nothing else is reachable through it. */
const MEDIAPIPE_FILES: Record<string, string> = {
  'vision_wasm_internal.js': 'text/javascript',
  'vision_wasm_internal.wasm': 'application/wasm',
  'selfie_segmenter.tflite': 'application/octet-stream'
}
/** The secret scenes' models (built with tools/blender), served on tcres://secret/<name>. */
const SECRET_FILES = new Set(['vision.glb', 'builds.glb', 'boss.glb', 'glasses.glb'])
function secretFile(name: string): string | null {
  if (!SECRET_FILES.has(name)) return null
  const dirs = app.isPackaged
    ? [join(process.resourcesPath, 'secret')]
    : [app.getAppPath(), join(__dirname, '../..'), process.cwd()].map((root) => join(root, 'resources', 'secret'))
  return dirs.map((d) => join(d, name)).find((p) => existsSync(p)) ?? null
}
function mediapipeFile(name: string): string | null {
  const dirs = app.isPackaged
    ? [join(process.resourcesPath, 'mediapipe')]
    : [app.getAppPath(), join(__dirname, '../..'), process.cwd()].flatMap((root) => [
        join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
        join(root, 'resources', 'models')
      ])
  return dirs.map((d) => join(d, name)).find((p) => existsSync(p)) ?? null
}

let win: BrowserWindow | null = null
/** The user's generation in progress, so Cancel can stop it. */
let generation: AbortController | null = null

// One window only: a second launch focuses the running app instead of fighting over the generator and files.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore()
  win?.focus()
})
app.setAppUserModelId('com.thumbcraft.app')

/**
 * Paths the user picked in a dialog (or that came from our own scans) this session. File-system IPC only
 * acts on these, so a compromised page can't point the app at arbitrary files.
 */
const pickedPaths = new Set<string>()
const picked = (p: unknown, what: string): string => {
  if (typeof p !== 'string' || !pickedPaths.has(p)) throw new Error(`Choose the ${what} again`)
  return p
}

/**
 * A window that never shows anything is the worst way to fail. Report why in the terminal (and, if the
 * interface still hasn't appeared after a while, in a dialog), instead of leaving a silent dark window.
 */
function watchStartup(w: BrowserWindow, devUrl: string | undefined): void {
  const wc = w.webContents
  wc.on('did-fail-load', (_e, code, description, url) =>
    console.error(`[ThumbCraft] The window failed to load ${url}: ${description} (${code})`)
  )
  wc.on('render-process-gone', (_e, details) =>
    console.error(`[ThumbCraft] The window's process stopped: ${details.reason} (exit code ${details.exitCode})`)
  )
  wc.on('preload-error', (_e, path, error) => console.error(`[ThumbCraft] Preload failed (${path}):`, error))
  // While developing, the page's own errors show up in the terminal running `npm run dev`.
  if (devUrl)
    wc.on('console-message', (e) => {
      if (e.level === 'error') console.error(`[renderer] ${e.message} (${e.sourceId}:${e.lineNumber})`)
    })
  wc.once('did-finish-load', () => {
    setTimeout(async () => {
      if (w.isDestroyed()) return
      const shown = await wc.executeJavaScript('document.getElementById("root")?.childElementCount ?? 0').catch(() => 0)
      if (shown) return
      console.error('[ThumbCraft] The interface has not appeared after 20 seconds.')
      void dialog.showMessageBox(w, {
        type: 'warning',
        title: 'ThumbCraft',
        message: 'ThumbCraft is taking unusually long to start.',
        detail:
          'Press Ctrl+R (Cmd+R on a Mac) to reload the window. If it stays dark, close the app and start it again; ' +
          'when running from source, the terminal lists the error.'
      })
    }, 20_000)
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0c0e',
    title: 'ThumbCraft',
    // Installed builds carry the icon in the executable; this covers `npm run dev` and Linux.
    icon: [join(app.getAppPath(), 'build', 'icon.png'), join(__dirname, '../../build/icon.png')].find((p) =>
      existsSync(p)
    ),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  // Give the renderer a moment to write its recovery copy before the window goes away.
  let flushed = false
  win.on('close', (e) => {
    if (flushed || !win) return
    e.preventDefault()
    const done = (): void => {
      if (flushed) return
      flushed = true
      win?.close()
    }
    ipcMain.once('app:flushed', done)
    setTimeout(done, 2500)
    win.webContents.send('app:flush')
  })
  // The app never navigates; a stray link or drop must not load another page next to the preload API.
  // (In development the dev server may reload its own page after re-bundling dependencies.)
  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  win.webContents.on('will-navigate', (e, url) => {
    if (!devUrl || !url.startsWith(devUrl)) e.preventDefault()
  })
  watchStartup(win, devUrl)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  // No version picker: use the newest Minecraft on this computer (or the jar chosen when none was found).
  ipcMain.handle('mc:loadNewest', () => {
    const last = readSettings().lastJar
    const jars = newestJars()
    for (const jarPath of last && !jars.length ? [last] : jars) {
      try {
        const bundle = loadJar(jarPath)
        pickedPaths.add(jarPath)
        updateSettings({ lastJar: jarPath })
        return bundle
      } catch {
        /* a broken or half-downloaded jar: try the next newest */
      }
    }
    return null
  })
  ipcMain.handle('mc:pickJar', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a Minecraft client jar',
      filters: [{ name: 'Minecraft client', extensions: ['jar'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    pickedPaths.add(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('mc:pickWorld', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a Minecraft world folder',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    pickedPaths.add(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('mc:loadJar', (_e, path: string) => {
    const jarPath = picked(path, 'Minecraft jar')
    const bundle = loadJar(jarPath)
    updateSettings({ lastJar: jarPath })
    return bundle
  })
  const javaInfo = async (): Promise<{ path: string; version: string; enough: boolean; need: number } | null> => {
    const need = requiredJava(currentVersion())
    const j = (await findJava(need)) ?? (await findJava())
    return j ? { path: j.path, version: j.version, enough: j.major >= need, need } : null
  }
  ipcMain.handle('mc:findJava', () => javaInfo())
  ipcMain.handle('java:install', async (e) => {
    await installJava(requiredJava(currentVersion()), (m) => e.sender.send('java:progress', m))
    rescanJava()
    return javaInfo()
  })
  ipcMain.handle('mc:downloadClient', async (e) => {
    const jar = await downloadLatestClient(cacheDir('clients'), (m) => e.sender.send('mc:clientProgress', m))
    pickedPaths.add(jar)
    return jar
  })
  ipcMain.handle('mc:eulaAccepted', () => readSettings().eulaAccepted === true)
  // Saved as soon as the box is ticked, so the generator can warm up before the first Generate.
  ipcMain.handle('mc:acceptEula', () => updateSettings({ eulaAccepted: true }))
  ipcMain.handle('skin:fetch', (_e, username: string) => fetchSkin(username))
  ipcMain.handle('terrain:generate', async (e, req: GenerateRequest & { acceptEula: boolean }) => {
    if (req.acceptEula) updateSettings({ eulaAccepted: true })
    generation?.abort()
    const controller = new AbortController()
    generation = controller
    try {
      return await generateTerrain(req, (p) => e.sender.send('terrain:progress', p), controller.signal)
    } finally {
      if (generation === controller) generation = null
    }
  })
  // Stops waiting for the current generation; the warm server keeps running for the next one.
  ipcMain.handle('terrain:cancel', () => generation?.abort())
  ipcMain.handle('terrain:prefetch', (_e, version: string, dimension: Dimension, biome: string, size: number) =>
    prefetchBiome(String(version), dimension, String(biome), Number(size))
  )
  ipcMain.handle('terrain:import', (_e, req: WorldImportRequest) => {
    if (!Number.isInteger(req.size) || req.size < 1 || req.size > 512) throw new Error('Invalid area size')
    // The dimension becomes part of a folder path: only the three real ones.
    if (!['overworld', 'the_nether', 'the_end'].includes(req.dimension)) throw new Error('Invalid dimension')
    const coord = (n: unknown): boolean => Number.isInteger(n) && Math.abs(n as number) <= 30_000_000
    if (!coord(req.centerX) || !coord(req.centerZ) || (req.centerY !== undefined && !coord(req.centerY)))
      throw new Error('Invalid coordinates')
    return importWorld({ ...req, worldDir: picked(req.worldDir, 'world folder') })
  })
  ipcMain.handle('terrain:prewarm', (_e, version: string, biomes: string[], size: number) =>
    prewarmGenerator(String(version), Array.isArray(biomes) ? biomes.map(String) : [], Number(size) || 48)
  )
  ipcMain.handle('project:save', (_e, bytes: Uint8Array, path: string | null, meta: ProjectMeta) =>
    saveProject(win!, bytes, path, meta)
  )
  ipcMain.handle('project:autosave', (_e, bytes: Uint8Array, meta: ProjectMeta) => autosave(bytes, meta))
  ipcMain.handle('project:open', () => openProjectDialog(win!))
  ipcMain.handle('project:recent', () => recentProjects())
  ipcMain.handle('project:openRecent', (_e, id: string) => readRecent(id))
  ipcMain.handle('project:forget', (_e, id: string) => forgetRecent(id))
  ipcMain.handle('mobs:load', (e) => loadMobModels((line) => e.sender.send('mobs:progress', line)))
  ipcMain.handle('structure:load', (_e, id: string) => {
    const bytes = readStructure(id)
    if (!bytes) throw new Error(`No structure "${id}" in this Minecraft version`)
    return structureToTerrain(parseNbt(gunzipCapped(bytes)))
  })
  ipcMain.handle('schematic:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import a schematic',
      filters: [{ name: 'Schematics', extensions: ['schem', 'litematic', 'nbt', 'schematic'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    return { name: basename(file), terrain: readSchematic(new Uint8Array(readFileSync(file)), basename(file)) }
  })
  ipcMain.handle('file:savePng', async (_e, dataUrl: string, suggestedName: string) => {
    const { bytes, ext } = imageBytes(dataUrl)
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export thumbnail',
      defaultPath: String(suggestedName).replace(/\.(png|jpe?g)$/i, '') + `.${ext}`,
      filters: [
        ext === 'png' ? { name: 'PNG image', extensions: ['png'] } : { name: 'JPG image', extensions: ['jpg', 'jpeg'] }
      ]
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, bytes)
    return r.filePath
  })
  ipcMain.handle('file:savePngs', async (_e, images: { name: string; dataUrl: string }[]) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose a folder for the exported thumbnails',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const dir = r.filePaths[0]
    const used = new Set<string>()
    for (const img of images) {
      // Plain file names only, inside the chosen folder, with the image's real extension, never overwriting.
      const { bytes, ext } = imageBytes(img.dataUrl)
      let safe =
        basename(String(img.name))
          .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
          .replace(/^\.+/, '')
          .replace(/\.(png|jpe?g)$/i, '') || 'thumbnail'
      safe += `.${ext}`
      while (used.has(safe.toLowerCase()) || existsSync(join(dir, safe))) safe = safe.replace(/(\.\w+)$/, '-1$1')
      used.add(safe.toLowerCase())
      writeFileSync(join(dir, safe), bytes)
    }
    return dir
  })
}

app.whenReady().then(() => {
  // The app needs no camera, microphone, notifications or other web permissions.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  protocol.handle('mcasset', (req) => {
    const url = new URL(req.url)
    const bytes = readAsset(`${url.hostname}${decodeURIComponent(url.pathname)}`)
    if (!bytes) return new Response('Not found', { status: 404 })
    const type = url.pathname.endsWith('.png') ? 'image/png' : 'application/json'
    return new Response(Buffer.from(bytes), { headers: { 'content-type': type, 'access-control-allow-origin': '*' } })
  })
  protocol.handle('tcres', (req) => {
    const url = new URL(req.url)
    const name = url.pathname.replace(/^\//, '')
    const secret = url.hostname === 'secret'
    const type = secret ? 'model/gltf-binary' : url.hostname === 'mediapipe' ? MEDIAPIPE_FILES[name] : undefined
    const file = !type ? null : secret ? secretFile(name) : mediapipeFile(name)
    if (!file) return new Response('Not found', { status: 404 })
    return new Response(readFileSync(file), { headers: { 'content-type': type!, 'access-control-allow-origin': '*' } })
  })
  registerIpc()
  createWindow()
  if (win) checkForUpdates(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void Promise.allSettled([shutdownGenerator(true), stopMobExport()]).finally(() => app.quit())
})

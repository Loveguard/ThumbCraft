// Carries out Claude's tool calls (see src/main/claude.ts and src/shared/claudeTools.ts) on the scene on screen,
// through the same store and helpers the panels use: every change shows at once, lands in undo and is saved.
import * as THREE from 'three'
import { BACKDROPS, type BackdropId } from '@shared/minecraft/backdrops'
import { fullPose, PART_NAMES, POSES, type PartName, type Pose } from '@shared/minecraft/playerModel'
import { HIDDEN_LAYERS, layerModel, layerName, textureCandidates } from '@shared/minecraft/entityModels'
import { CLIPS, animationLength, type ClipType } from '@shared/animation'
import { CAMS, type CamType } from '@shared/camera'
import { STARTER_PRESETS } from '@shared/presets'
import {
  addCamClip,
  addClip,
  animationOf,
  CAMERA,
  deleteClip,
  setCamClip,
  setClipDuration,
  applyPreset,
  canWalk,
  clearTrack,
  draftFromText,
  enterAnimation,
  exitAnimation,
  goTo,
  seek,
  useAnim
} from './animation'
import { captureFrame } from './capture'
import { building, viewport } from './components/Viewport'
import { PIXEL_TEXT_LABEL, TITLE_STYLES } from './components/tabs/SceneTabs'
import { encodeExport } from './exportImage'
import { LOOKS, lookSettings } from './grading'
import { layeredPsd } from './layeredExport'
import { addLight, LIGHT_PRESETS } from './lights'
import { assetUrl } from './minecraft/assets'
import { defaultSkinUrl } from './minecraft/builders'
import { mobModels } from './minecraft/mobs'
import { frameTransform, placeNew } from './placement'
import { usePresets } from './presetStore'
import { serializeProject } from './project'
import { saveProject, startNewProject } from './projectActions'
import { RENDER_MODES, type RenderMode } from './renderModes'
import { addTerrain, applyReadyMadeBiome } from './sceneActions'
import { embedSystemFont } from './components/SystemFonts'
import { registerMedia } from './media'
import type { SystemFont } from '@shared/api'
import type { TerrainData } from '@shared/types'
import { STICKERS, type StickerShape } from './stickers'
import {
  cameraBridge,
  defaultPose,
  NO_EQUIPMENT,
  newId,
  useStore,
  type Equipment,
  type SceneObject,
  type SkyPreset,
  type Vec3
} from './store'
import { applyTemplate, TEMPLATES } from './templates'
import { FONTS } from './textStyles'
import { exportAnimation, EXPORT_SIZES, type ExportKind } from './videoExport'
import { glbBytes } from './interchange'
import { VFX_PRESETS, vfxBounds } from './vfx'

type Params = Record<string, unknown>
type Handler = (p: Params) => Promise<unknown> | unknown

const SKY_PRESETS: SkyPreset[] = ['biome', 'clear', 'golden', 'sunset', 'night', 'overcast', 'nether', 'end', 'color']
const DEFAULT_SKINS = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri']

// ------------------------------------------------------------------ helpers

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const say = (what: string): void => st().setStatus(`Claude: ${what}`)
const r3 = (n: number): number => Math.round(n * 1000) / 1000
const v3 = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)))
    throw new Error(`${what} must be three numbers [x, y, z]`)
  return v as Vec3
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function objectById(id: unknown): SceneObject {
  const o = st().objects.find((x) => x.id === id) ?? st().objects.find((x) => x.name === id)
  if (!o) throw new Error(`No object "${String(id)}". Call get_scene for the ids.`)
  return o
}

/** An object as Claude sees it: no huge image data, numbers rounded. */
function describe(o: SceneObject, full = false): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.startsWith('data:')) out[k] = '(embedded image)'
    else if (typeof v === 'string' && v.startsWith('mcasset:'))
      out[k] = v.replace(/^mcasset:\/\/textures\/|\.png.*$/g, '')
    else if (typeof v === 'number') out[k] = r3(v)
    else if (Array.isArray(v) && v.every((n) => typeof n === 'number')) out[k] = v.map(r3)
    else if (!full && (k === 'pose' || k === 'partRotations')) out[k] = '(get_object for details)'
    else out[k] = v
  }
  return out
}

function camera(): { position: Vec3; target: Vec3; fov: number } {
  const c = cameraBridge.get?.()
  if (!c) throw new Error('The viewport is not ready yet')
  return { position: c.position.map(r3) as Vec3, target: c.target.map(r3) as Vec3, fov: st().settings.fov }
}

/** Where a new object goes: given, or where the camera looks (facing the camera). */
function placement(p: Params, style: 'ground' | 'floating', radius = 1): { position: Vec3; rotation: Vec3 } {
  const yaw = num(p.yaw)
  if (p.position === undefined) {
    const auto = placeNew(style, radius)
    return { position: auto.position, rotation: yaw !== undefined ? [0, yaw, 0] : auto.rotation }
  }
  const position = v3(p.position, 'position')
  // Given a spot but no direction: face the camera from there.
  return { position, rotation: [0, yaw ?? yawToward(position, camera().position), 0] }
}

const yawToward = (from: Vec3, to: Vec3): number =>
  Math.round(THREE.MathUtils.radToDeg(Math.atan2(to[0] - from[0], to[2] - from[2])) * 10) / 10

function poseFrom(value: unknown, current: Pose | undefined): Pose {
  if (typeof value === 'string') {
    const name = Object.keys(POSES).find((k) => k.toLowerCase() === value.toLowerCase())
    if (!name) throw new Error(`Unknown pose "${value}". Poses: ${Object.keys(POSES).join(', ')}`)
    return structuredClone(POSES[name])
  }
  if (value && typeof value === 'object') {
    const pose = fullPose(current)
    for (const [k, v] of Object.entries(value)) {
      if (!PART_NAMES.includes(k as PartName)) throw new Error(`Unknown joint "${k}". Joints: ${PART_NAMES.join(', ')}`)
      pose[k as PartName] = v3(v, `pose.${k}`)
    }
    return pose
  }
  throw new Error('pose must be a pose name or {joint: [x, y, z]}')
}

const fontFamily = (label: string): string => {
  const f = FONTS.find((x) => x.label.toLowerCase() === label.toLowerCase() || x.family === label)
  if (!f) throw new Error(`Unknown font "${label}". Fonts: ${FONTS.map((x) => x.label).join(', ')}`)
  return f.family
}

/** A flat camera-facing layer at a spot of the frame (x, y from the top-left, 0…1), tilted by `roll` degrees. */
function onFrame(
  x: number,
  y: number,
  height: number,
  unitHeight: number,
  depth = 2,
  roll = 0
): { position: Vec3; rotation: Vec3; scale: number } {
  const c = camera()
  const s = st().settings
  const t = frameTransform(c.position, c.target, c.fov, s.exportWidth / s.exportHeight, {
    screen: [x * 2 - 1, 1 - y * 2],
    height,
    unitHeight,
    depth
  })
  if (roll) {
    const d = THREE.MathUtils.degToRad
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(d(t.rotation[0]), d(t.rotation[1]), d(t.rotation[2])))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d(-roll)))
    const e = new THREE.Euler().setFromQuaternion(q)
    t.rotation = [e.x, e.y, e.z].map((r) => THREE.MathUtils.radToDeg(r)) as Vec3
  }
  return t
}

let systemFonts: Promise<SystemFont[]> | null = null
/** Embeds an installed font (by its full name, or the words in it) and returns its media id. */
async function systemFontId(name: string): Promise<string> {
  systemFonts ??= window.blockframe.listSystemFonts().catch((e) => {
    systemFonts = null
    throw e
  })
  const list = await systemFonts
  const want = name.toLowerCase()
  const words = want.split(/\s+/).filter(Boolean)
  const f =
    list.find((x) => x.full.toLowerCase() === want) ??
    list.find((x) => x.family.toLowerCase() === want && /^(regular|normal|book)?$/i.test(x.style)) ??
    list.find((x) => words.every((w) => x.full.toLowerCase().includes(w)))
  if (!f) throw new Error(`No installed font matches "${name}". Use list_fonts to search.`)
  return embedSystemFont(f)
}

const imageAspect = async (url: string): Promise<number> => {
  const img = new Image()
  img.src = url
  await img.decode()
  return img.naturalWidth / img.naturalHeight || 1
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

function textureOk(path: string): boolean {
  return new Set(st().assets?.textures ?? []).has(path)
}

const toBase64 = (bytes: Uint8Array): string => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const dataUrlBase64 = (url: string): string => url.slice(url.indexOf(',') + 1)

async function toJpeg(png: string, quality = 0.88): Promise<string> {
  const img = new Image()
  img.src = png
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c.toDataURL('image/jpeg', quality)
}

/** Mob layers offered in the Mobs tab (each model's main layer). */
async function mobLayers(): Promise<string[]> {
  const models = await mobModels()
  const all = Object.keys(models.layers).filter((k) => !HIDDEN_LAYERS.test(layerModel(k)))
  const hasMain = new Set(all.filter((k) => layerName(k) === 'main').map(layerModel))
  const firstOf = new Map<string, string>()
  for (const k of all) if (!firstOf.has(layerModel(k))) firstOf.set(layerModel(k), k)
  return all.filter((k) => layerName(k) === 'main' || (!hasMain.has(layerModel(k)) && firstOf.get(layerModel(k)) === k))
}

const added = (): Record<string, unknown> => {
  const o = st().objects.at(-1)
  return o ? { added: describe(o) } : {}
}

function inAnimation(): void {
  if (useAnim.getState().mode !== 'animation') enterAnimation()
}

/** Writes what the animation says (`note`) back to Claude when a call didn't change anything. */
function animationNote(): string | null {
  return useAnim.getState().note
}

// ------------------------------------------------------------------ tools

const handlers: Record<string, Handler> = {
  get_scene: () => {
    const s = st()
    const a = s.settings.animation
    const { animation: _a, shot: _shot, ...settings } = s.settings
    return {
      project: { name: s.project.name, path: s.project.path, unsaved: s.project.dirty },
      minecraft: s.assets?.version ?? 'not loaded',
      mode: useAnim.getState().mode,
      camera: camera(),
      objects: s.objects.map((o) => describe(o)),
      selected: s.selectedIds,
      settings,
      effects: s.effects,
      sky: { ...s.sky, hdriMediaId: undefined },
      animation:
        a?.tracks.length || a?.camera?.clips.length
          ? { length: r3(animationLength(a)), tracks: a.tracks.length, cameraBlocks: a.camera?.clips.length ?? 0 }
          : null
    }
  },

  get_object: (p) => describe(objectById(p.id), true),

  get_options: async (p) => {
    const options: Record<string, unknown> = {
      poses: Object.keys(POSES),
      joints: PART_NAMES,
      defaultSkins: DEFAULT_SKINS,
      fonts: FONTS.map((f) => f.label),
      textStyles: ['caption', 'pixel', 'stone', 'hardcore'],
      stickers: STICKERS.map((k) => k.id),
      effects: [...VFX_PRESETS.filter((v) => !v.retired).map((v) => ({ id: v.id, hint: v.hint })), { id: 'lightning' }],
      lights: LIGHT_PRESETS.map((l) => ({ id: l.id, hint: l.hint })),
      biomes: BACKDROPS.map((b) => ({ id: b.id, name: b.name })),
      skies: SKY_PRESETS,
      renderModes: RENDER_MODES.map((m) => ({ id: m.id, hint: m.hint })),
      looks: LOOKS.map((l) => ({ id: l.id, label: l.label, hint: l.hint })),
      templates: TEMPLATES.filter((t) => !t.secret).map((t) => ({ id: t.id, name: t.name, hint: t.hint })),
      animationBlocks: Object.entries(CLIPS).map(([id, c]) => ({
        id,
        label: c.label,
        seconds: c.duration,
        hint: c.hint
      })),
      cameraMoves: Object.entries(CAMS).map(([id, c]) => ({ id, label: c.label, seconds: c.duration })),
      animationPresets: [...STARTER_PRESETS, ...usePresets.getState().presets].map((x) => ({ id: x.id, name: x.name }))
    }
    if (p.include_mobs) {
      try {
        options.mobs = (await mobLayers()).map((k) => k.replace(/^minecraft:/, '').replace(/#main$/, ''))
      } catch (e) {
        options.mobs = `Mob models unavailable: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    return options
  },

  screenshot: async (p) => {
    const s = st().settings
    const width = Math.round(Math.min(1920, Math.max(64, num(p.width) ?? 960)))
    const height = Math.round(Math.min(1920, Math.max(64, num(p.height) ?? (width * s.exportHeight) / s.exportWidth)))
    await settled()
    let url = await captureFrame(width, height)
    const jpg = p.format !== 'png'
    if (jpg) url = await toJpeg(url, 0.85)
    return { width, height, image: { base64: dataUrlBase64(url), mimeType: jpg ? 'image/jpeg' : 'image/png' } }
  },

  add_player: async (p) => {
    const username = str(p.username)
    let skinUrl: string
    let slim = p.slim === true
    let name = str(p.name)
    if (username) {
      const skin = await window.blockframe.fetchSkin(username)
      skinUrl = skin.skinDataUrl
      slim = skin.model === 'slim'
      name ??= skin.username
    } else {
      const skinName = (str(p.skin) ?? (slim ? 'alex' : 'steve')).toLowerCase()
      if (p.slim === undefined) slim = skinName === 'alex'
      const path = `entity/player/${slim ? 'slim' : 'wide'}/${skinName}`
      if (!DEFAULT_SKINS.includes(skinName))
        throw new Error(`skin must be one of ${DEFAULT_SKINS.join(', ')} (or give a username)`)
      skinUrl = textureOk(path) ? assetUrl(path) : defaultSkinUrl(slim)
      name ??= skinName[0].toUpperCase() + skinName.slice(1)
    }
    st().add({
      id: newId('obj'),
      kind: 'player',
      name,
      skinUrl,
      slim,
      pose: p.pose !== undefined ? poseFrom(p.pose, undefined) : defaultPose(),
      ...(p.name_tag === true && { nameTag: true }),
      visible: true,
      ...placement(p, 'ground'),
      scale: num(p.scale) ?? 1
    })
    say(`added ${name}`)
    return added()
  },

  add_text: async (p) => {
    const text = str(p.text)?.replace(/\\n/g, '\n')
    if (!text) throw new Error('text is empty')
    const style = (str(p.style) ?? 'caption') as 'caption' | 'pixel' | 'stone' | 'hardcore'
    const lines = text.split('\n').length
    const name = str(p.name)
    if (style === 'caption') {
      const spot =
        num(p.x) !== undefined || num(p.y) !== undefined || p.position === undefined
          ? onFrame(num(p.x) ?? 0.5, num(p.y) ?? 0.18, num(p.height) ?? 0.22 * lines, 1.6 * lines)
          : { ...placement(p, 'floating'), scale: num(p.scale) ?? 1 }
      st().add({
        id: newId('obj'),
        kind: 'text',
        name: name ?? `Caption: ${text.slice(0, 16)}`,
        text,
        color: str(p.color) ?? '#ffe14d',
        outlineColor: str(p.outline_color) ?? '#000000',
        outlineWidth: num(p.outline_width) ?? 14,
        font: str(p.font) ? fontFamily(str(p.font)!) : FONTS[0].family,
        ...(str(p.system_font) && { fontMediaId: await systemFontId(str(p.system_font)!) }),
        shadow: p.shadow !== false,
        onTop: true,
        ...(str(p.gradient) && { gradient: str(p.gradient) }),
        ...(str(p.glow) && { glow: str(p.glow) }),
        visible: true,
        ...spot
      })
    } else {
      const title = TITLE_STYLES.find((t) => t.style === style)
      if (style !== 'pixel' && !title) throw new Error('style must be caption, pixel, stone or hardcore')
      st().add({
        id: newId('obj'),
        kind: 'pixelText',
        name: name ?? `${title?.label ?? PIXEL_TEXT_LABEL}: ${text.slice(0, 16)}`,
        text,
        color: str(p.color) ?? title?.color ?? '#ffffff',
        depth: title ? 4 : 2,
        shadow: true,
        ...(title && { style: title.style }),
        visible: true,
        ...placement(p, 'floating'),
        scale: num(p.scale) ?? 1
      })
    }
    say(`added “${text.replace(/\n/g, ' ')}”`)
    return added()
  },

  add_sticker: (p) => {
    const shape = str(p.shape) as StickerShape
    const def = STICKERS.find((k) => k.id === shape)
    if (!def) throw new Error(`shape must be one of ${STICKERS.map((k) => k.id).join(', ')}`)
    st().add({
      id: newId('obj'),
      kind: 'sticker',
      name: def.label,
      shape,
      color: str(p.color) ?? def.color,
      outline: p.outline !== false,
      glow: p.glow === true,
      ...(p.flip === true && { flip: true }),
      visible: true,
      position: [num(p.x) ?? 0.5, num(p.y) ?? 0.5, 0],
      rotation: [0, 0, num(p.rotation) ?? (shape === 'arrow' ? 20 : 0)],
      scale: num(p.size) ?? (shape === 'box' ? 0.4 : 0.28)
    })
    say(`added a ${def.label.toLowerCase()}`)
    return added()
  },

  add_mob: async (p) => {
    const want = str(p.mob)?.toLowerCase()
    if (!want) throw new Error('mob is empty')
    const models = await mobModels()
    const layers = await mobLayers()
    const giant = want === 'giant' && !models.layers['minecraft:giant#main']
    const ns = want.includes(':') ? want : `minecraft:${want}`
    const key = giant
      ? 'minecraft:zombie#main'
      : models.layers[ns]
        ? ns
        : (layers.find((k) => k === `${ns}#main`) ??
          layers.find((k) => layerModel(k) === ns.replace(/#.*/, '').replace(/^minecraft:/, '')))
    if (!key || !models.layers[key])
      throw new Error(`No mob "${want}" in this Minecraft version. See get_options include_mobs.`)
    const texture = textureCandidates(key, models.layers[key], models.textureSizes)[0]
    if (!texture) throw new Error(`No entity texture in this jar matches ${want}`)
    const name =
      str(p.name) ??
      (giant
        ? 'Giant'
        : want
            .replace(/^minecraft:|#.*$/g, '')
            .replace(/_/g, ' ')
            .replace(/^./, (c) => c.toUpperCase()))
    st().add({
      id: newId('obj'),
      kind: 'mob',
      name,
      layer: key,
      texture,
      partRotations: {},
      visible: true,
      ...placement(p, 'ground', giant ? 4 : 1),
      scale: num(p.scale) ?? (giant ? 6 : 1)
    })
    say(`added a ${name.toLowerCase()}`)
    return added()
  },

  add_image: async (p) => {
    let url: string
    let mediaId: string | undefined
    let name = str(p.name)
    const texture = str(p.texture)
    if (str(p.data)) {
      const bytes = fromBase64(str(p.data)!)
      const mime = str(p.mime) ?? (bytes[0] === 0x89 ? 'image/png' : 'image/jpeg')
      const media = registerMedia(name ?? 'Picture', mime, bytes)
      url = media.url
      mediaId = media.id
    } else if (texture) {
      const path = texture
        .replace(/^minecraft:/, '')
        .replace(/^textures\//, '')
        .replace(/\.png$/, '')
      if (!textureOk(path)) throw new Error(`No texture "${path}" in this Minecraft version (e.g. item/diamond_sword)`)
      url = assetUrl(path)
      name ??= path.split('/').pop()!.replace(/_/g, ' ')
    } else throw new Error('Give file, data or texture')
    const aspect = await imageAspect(url)
    const framed = num(p.x) !== undefined || num(p.y) !== undefined || p.position === undefined
    const spot = framed
      ? onFrame(num(p.x) ?? 0.5, num(p.y) ?? 0.5, num(p.height) ?? 0.3, 4, num(p.depth) ?? 2, num(p.roll) ?? 0)
      : { ...placement(p, 'floating'), scale: num(p.scale) ?? 1 }
    st().add({
      id: newId('obj'),
      kind: 'image',
      name: name ?? 'Picture',
      url,
      ...(mediaId && { mediaId }),
      aspect,
      opacity: num(p.opacity) ?? 1,
      onTop: p.on_top === true,
      ...((p.pixelated ?? !!texture) && { pixelated: true }),
      ...(str(p.tint) && { tint: str(p.tint) }),
      visible: true,
      ...spot
    })
    say(`added ${name ?? 'a picture'}`)
    return added()
  },

  add_block: (p) => {
    const id = str(p.block)
    if (!id) throw new Error('block is empty')
    const full = id.includes(':') ? id : `minecraft:${id}`
    const bare = full.replace(/^minecraft:/, '')
    const states = st().assets?.blockstates as Record<string, unknown> | undefined
    if (states && !(bare in states) && !(full in states)) throw new Error(`No block "${id}" in this Minecraft version`)
    const props = (p.properties ?? (bare === 'grass_block' ? { snowy: 'false' } : {})) as Record<string, string>
    const t: TerrainData = {
      sizeX: 1,
      sizeY: 1,
      sizeZ: 1,
      originX: 0,
      originY: 0,
      originZ: 0,
      palette: [
        { name: 'minecraft:air', properties: {} },
        { name: full, properties: props }
      ],
      blocks: new Uint16Array([1]),
      biomePalette: ['minecraft:plains'],
      biomes: new Uint16Array([0]),
      dimension: 'overworld'
    }
    const scale = num(p.scale) ?? 1
    let position: Vec3
    if (num(p.x) !== undefined || num(p.y) !== undefined)
      position = onFrame(num(p.x) ?? 0.5, num(p.y) ?? 0.5, 0.1, 1, num(p.depth) ?? 6).position
    else if (p.position !== undefined) position = v3(p.position, 'position')
    else position = placeNew('floating').position
    // A block's corner is its origin: centre it on the spot.
    position = position.map((v) => v - scale / 2) as Vec3
    const name = str(p.name) ?? bare.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
    addTerrain(t, name, position)
    const o = st().objects.at(-1)!
    const rotation = p.rotation !== undefined ? v3(p.rotation, 'rotation') : [0, num(p.yaw) ?? 0, 0]
    st().update(o.id, { rotation: rotation as Vec3, scale })
    say(`added ${name.toLowerCase()}`)
    return added()
  },

  list_fonts: async (p) => {
    systemFonts ??= window.blockframe.listSystemFonts()
    const list = await systemFonts
    const words = (str(p.search) ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const hits = list.filter((f) => words.every((w) => f.full.toLowerCase().includes(w)))
    return { total: list.length, matches: hits.length, fonts: hits.slice(0, 80).map((f) => f.full) }
  },

  add_effect: (p) => {
    const effect = str(p.effect)
    if (!effect) throw new Error('effect is empty')
    const light = LIGHT_PRESETS.find((l) => l.id.toLowerCase() === effect.toLowerCase())
    if (light) {
      addLight(light.id)
      const o = st().objects.at(-1)!
      const patch: Partial<SceneObject> = {}
      if (p.position !== undefined) patch.position = v3(p.position, 'position')
      if (str(p.color)) (patch as { color: string }).color = str(p.color)!
      if (str(p.name)) patch.name = str(p.name)!
      if (Object.keys(patch).length) st().update(o.id, patch)
    } else if (effect === 'lightning') {
      st().add({
        id: newId('obj'),
        kind: 'lightning',
        name: str(p.name) ?? 'Lightning',
        seed: Math.floor(Math.random() * 2 ** 31),
        color: str(p.color) ?? '#737380',
        brightness: 1.5,
        thickness: 0.5,
        flash: true,
        visible: true,
        ...placement(p, 'ground'),
        scale: num(p.scale) ?? 1
      })
    } else {
      const v = VFX_PRESETS.find((x) => x.id === effect)
      if (!v) throw new Error(`Unknown effect "${effect}". See get_options effects and lights.`)
      st().add({
        id: newId('obj'),
        kind: 'vfx',
        name: str(p.name) ?? v.label,
        effect: v.id,
        color: str(p.color) ?? v.color,
        density: num(p.density) ?? v.density,
        opacity: 1,
        glow: v.glow,
        seed: Math.floor(Math.random() * 2 ** 31),
        visible: true,
        ...placement(p, 'ground', vfxBounds(v.id)[0]),
        scale: num(p.scale) ?? 1
      })
    }
    say(`added ${effect}`)
    return added()
  },

  set_ground: (p) => {
    const id = str(p.biome)?.toLowerCase() as BackdropId
    if (!BACKDROPS.some((b) => b.id === id))
      throw new Error(`Unknown biome. Biomes: ${BACKDROPS.map((b) => b.id).join(', ')}`)
    applyReadyMadeBiome(id)
    say(`changed the ground to ${id}`)
    return { ground: id }
  },

  apply_template: async (p) => {
    const t = TEMPLATES.find((x) => x.id === p.template || x.name === p.template)
    if (!t) throw new Error('Unknown template. See get_options templates.')
    if (useAnim.getState().mode === 'animation') exitAnimation()
    await applyTemplate(t)
    await settled()
    say(`started from “${t.name}”`)
    return { template: t.id, objects: st().objects.map((o) => describe(o)) }
  },

  update_object: async (p) => {
    const o = objectById(p.id)
    const c = { ...((p.changes ?? {}) as Params) }
    const patch: Record<string, unknown> = {}
    for (const k of ['position', 'rotation'] as const) if (c[k] !== undefined) patch[k] = v3(c[k], k)
    if (num(c.yaw) !== undefined) patch.rotation = [o.rotation[0], c.yaw, o.rotation[2]]
    if (p.look_at !== undefined) {
      const to = typeof p.look_at === 'string' ? objectById(p.look_at).position : v3(p.look_at, 'look_at')
      const from = (patch.position as Vec3) ?? o.position
      patch.rotation = [0, yawToward(from, to), 0]
    }
    if (o.kind === 'player') {
      if (c.pose !== undefined) patch.pose = poseFrom(c.pose, o.pose)
      if (c.equipment !== undefined)
        patch.equipment = { ...NO_EQUIPMENT, ...o.equipment, ...(c.equipment as Partial<Equipment>) }
    }
    if ((o.kind === 'text' || o.kind === 'pixelText') && typeof c.text === 'string')
      patch.text = c.text.replace(/\\n/g, '\n')
    if (o.kind === 'text' && typeof c.font === 'string') {
      patch.font = fontFamily(c.font)
      patch.fontMediaId = undefined
    }
    if (o.kind === 'text' && typeof c.system_font === 'string') patch.fontMediaId = await systemFontId(c.system_font)
    if (o.kind === 'sticker') {
      if (num(c.x) !== undefined || num(c.y) !== undefined)
        patch.position = [num(c.x) ?? o.position[0], num(c.y) ?? o.position[1], 0]
      if (num(c.size) !== undefined) patch.scale = c.size
      if (num(c.rotation) !== undefined) patch.rotation = [0, 0, c.rotation]
    }
    const handled = new Set([
      'position',
      'rotation',
      'yaw',
      'pose',
      'equipment',
      'text',
      'font',
      'system_font',
      'x',
      'y',
      'size'
    ])
    for (const [k, v] of Object.entries(c)) {
      if (handled.has(k)) continue
      if (k === 'id' || k === 'kind') throw new Error(`${k} can't be changed`)
      if (
        !(k in o) &&
        ![
          'onTop',
          'flat',
          'nameTag',
          'gradient',
          'glow',
          'outline2Color',
          'outline2Width',
          'flip',
          'weight',
          'stretch',
          'thickness',
          'style',
          'rim'
        ].includes(k)
      )
        throw new Error(`A ${o.kind} has no field "${k}". get_object shows its fields.`)
      patch[k] = v
    }
    if (!Object.keys(patch).length) throw new Error('Nothing to change')
    st().update(o.id, patch as Partial<SceneObject>)
    say(`changed ${o.name}`)
    return describe(objectById(o.id))
  },

  remove_object: (p) => {
    const ids = Array.isArray(p.ids) ? p.ids.map((x) => objectById(x).id) : []
    if (!ids.length) throw new Error('ids is empty')
    st().setSelection(ids)
    st().removeSelected()
    say(`deleted ${ids.length} object${ids.length > 1 ? 's' : ''}`)
    return { removed: ids }
  },

  duplicate_object: (p) => {
    st().duplicate(objectById(p.id).id)
    say('duplicated an object')
    return added()
  },

  arrange: (p) => {
    if (Array.isArray(p.select)) st().setSelection(p.select.map((x) => objectById(x).id))
    const ro = p.reorder as { id?: string; by?: number } | undefined
    if (ro?.id) st().reorder(objectById(ro.id).id, num(ro.by) ?? 0)
    if (p.group === true) st().groupSelected()
    if (p.group === false) st().ungroupSelected()
    return { order: st().objects.map((o) => o.id), selected: st().selectedIds }
  },

  set_camera: (p) => {
    const now = camera()
    let position = p.position !== undefined ? v3(p.position, 'position') : now.position
    let target = p.target !== undefined ? v3(p.target, 'target') : now.target
    const fr = p.frame as { id?: string; from?: string; distance?: number } | undefined
    if (fr?.id) {
      const o = objectById(fr.id)
      const tall = o.kind === 'player' || o.kind === 'mob' ? 1.1 * o.scale : 0.5 * o.scale
      target = [o.position[0], o.position[1] + tall, o.position[2]]
      const yaw = THREE.MathUtils.degToRad(o.rotation[1])
      const turn =
        { front: 0, left: Math.PI / 2, right: -Math.PI / 2, back: Math.PI, above: 0, low: 0 }[fr.from ?? 'front'] ?? 0
      const d = num(fr.distance) ?? 4
      const up = fr.from === 'above' ? d * 0.9 : fr.from === 'low' ? -tall * 0.7 : d * 0.12
      position = [target[0] + Math.sin(yaw + turn) * d, target[1] + up, target[2] + Math.cos(yaw + turn) * d]
    }
    const before = cameraBridge.get?.()
    cameraBridge.set?.({ position, target })
    if (before) st().recordCamera(before)
    const fov = num(p.fov) ?? st().settings.fov
    st().setSettings({ fov, ...(p.save_shot !== false && { shot: { position, target, fov } }) })
    say('moved the camera')
    return camera()
  },

  set_look: (p) => {
    const s = st()
    if (str(p.render_mode)) {
      if (!RENDER_MODES.some((m) => m.id === p.render_mode))
        throw new Error(`render_mode must be ${RENDER_MODES.map((m) => m.id).join(', ')}`)
      s.setSettings({ renderMode: p.render_mode as RenderMode })
    }
    if (p.look === null) s.setEffects({ look: null })
    else if (str(p.look)) {
      if (!LOOKS.some((l) => l.id === p.look))
        throw new Error(`look must be ${LOOKS.map((l) => l.id).join(', ')} or null`)
      const { sunInView: _sun, ...look } = lookSettings(p.look as string)
      s.setEffects(look)
    }
    if (num(p.look_intensity) !== undefined)
      s.setEffects({ lookIntensity: Math.min(1, Math.max(0, p.look_intensity as number)) })
    if (str(p.sky)) {
      if (!SKY_PRESETS.includes(p.sky as SkyPreset)) throw new Error(`sky must be ${SKY_PRESETS.join(', ')}`)
      s.setSky({ preset: p.sky as SkyPreset, ...(str(p.sky_color) && { color: str(p.sky_color) }) })
    } else if (str(p.sky_color)) s.setSky({ color: str(p.sky_color)! })
    const known = (patch: unknown, base: object, what: string): Record<string, unknown> => {
      if (patch === undefined) return {}
      if (!patch || typeof patch !== 'object') throw new Error(`${what} must be an object`)
      for (const k of Object.keys(patch)) if (!(k in base)) throw new Error(`Unknown ${what} field "${k}"`)
      return patch as Record<string, unknown>
    }
    const settings = known(
      p.settings,
      { ...s.settings, customLighting: null, showRulers: false, split: null, animation: null },
      'settings'
    )
    delete settings.animation
    if (Object.keys(settings).length) s.setSettings(settings)
    const effects = known(p.effects, s.effects, 'effects')
    if (Object.keys(effects).length) s.setEffects(effects)
    say('changed the look')
    const n = st()
    return { renderMode: n.settings.renderMode, look: n.effects.look, sky: n.sky.preset }
  },

  history: (p) => {
    const steps = Math.min(50, Math.max(1, num(p.steps) ?? 1))
    for (let i = 0; i < steps; i++) (p.action === 'redo' ? st().redo : st().undo)()
    say(p.action === 'redo' ? 'redo' : 'undo')
    return { objects: st().objects.length }
  },

  export_thumbnail: async (p) => {
    const s = st()
    const { exportWidth: w, exportHeight: h } = s.settings
    await settled()
    const name = s.project.name || 'thumbnail'
    if (p.layered === true) {
      const bytes = await layeredPsd(w, h)
      say('exported layers for Photoshop')
      return { width: w, height: h, file: { base64: toBase64(bytes), ext: '.psd', name } }
    }
    const format =
      p.format === 'png' || (p.format === undefined && /\.png$/i.test(String(p.path ?? '')))
        ? 'png'
        : s.settings.exportFormat
    const url = await encodeExport(await captureFrame(w, h), p.format === 'jpg' ? 'jpg' : format)
    const ext = url.startsWith('data:image/png') ? '.png' : '.jpg'
    say('exported the thumbnail')
    return { width: w, height: h, file: { base64: dataUrlBase64(url), ext, name } }
  },

  project: async (p) => {
    switch (p.action) {
      case 'new':
        if (useAnim.getState().mode === 'animation') exitAnimation()
        startNewProject()
        await new Promise((r) => setTimeout(r, 300))
        say('started a new project')
        return { project: st().project.name }
      case 'rename': {
        const name = str(p.name)
        if (!name) throw new Error('name is empty')
        st().setProject({ name, dirty: true })
        return { project: name }
      }
      case 'save':
        if (str(p.path))
          return { file: { base64: toBase64(serializeProject()), ext: '.bfproj', name: st().project.name } }
        if (!st().project.path) throw new Error('This project has never been saved: give a path (…\\name.bfproj)')
        await saveProject()
        return { savedTo: st().project.path }
      default:
        throw new Error('action must be new, save or rename')
    }
  },

  animation: async (p) => {
    const action = String(p.action)
    const objectId = (): string => {
      const o = objectById(p.id)
      if (!canWalk(o)) throw new Error(`${o.name} can't be animated (players and mobs can)`)
      return o.id
    }
    const before = JSON.stringify(animationOf())
    useAnim.setState({ note: null })
    const summary = (): Record<string, unknown> => {
      const a = animationOf()
      const edit = ['script', 'add_block', 'go_to', 'add_camera', 'preset', 'clear'].includes(action)
      const unchanged = edit && JSON.stringify(a) === before
      return {
        ...(unchanged && { unchanged: true, note: animationNote() }),
        mode: useAnim.getState().mode,
        length: r3(animationLength(a)),
        time: r3(useAnim.getState().time),
        tracks: a.tracks.map((t) => ({
          id: t.objectId,
          name: st().objects.find((o) => o.id === t.objectId)?.name,
          blocks: (t.clips ?? []).map((c) => ({
            id: c.id,
            type: c.type,
            start: c.start,
            seconds: c.duration,
            ...(c.layer && { layer: c.layer })
          }))
        })),
        camera: (a.camera?.clips ?? []).map((c) => ({ id: c.id, type: c.type, start: c.start, seconds: c.duration }))
      }
    }
    switch (action) {
      case 'enter':
        enterAnimation()
        break
      case 'exit':
        exitAnimation()
        break
      case 'get':
        break
      case 'script': {
        inAnimation()
        const text = str(p.text)
        if (!text) throw new Error('text is empty')
        if (p.travel) useAnim.setState({ travel: p.travel as 'walk' })
        const r = draftFromText(text)
        if (r?.unknown.length) return { ...summary(), notUnderstood: r.unknown }
        break
      }
      case 'add_block': {
        inAnimation()
        const type = str(p.type) as ClipType
        if (!type || !(type in CLIPS)) throw new Error('Unknown block type. See get_options animationBlocks.')
        const oid = objectId()
        const had = new Set((animationOf().tracks.find((t) => t.objectId === oid)?.clips ?? []).map((c) => c.id))
        addClip(oid, type, num(p.at), p.upper_body === true ? 'upper' : undefined)
        const made = animationOf()
          .tracks.find((t) => t.objectId === oid)
          ?.clips?.find((c) => !had.has(c.id))
        const len = num(p.length)
        if (made && len && len > 0) setClipDuration(oid, made.id, len)
        break
      }
      case 'go_to': {
        inAnimation()
        if (p.travel) useAnim.setState({ travel: p.travel as 'walk' })
        if (!goTo(objectId(), v3(p.point, 'point'))) return { ...summary(), note: animationNote() ?? 'No way there' }
        break
      }
      case 'add_camera': {
        inAnimation()
        const type = str(p.camera ?? p.type) as CamType
        if (!type || !(type in CAMS)) throw new Error('Unknown camera move. See get_options cameraMoves.')
        const had = new Set((animationOf().camera?.clips ?? []).map((c) => c.id))
        addCamClip(type, num(p.at), num(p.length))
        const made = animationOf().camera?.clips.find((c) => !had.has(c.id))
        if (made) {
          // A start view of its own makes a hard cut; a subject makes the move frame that character.
          if (Array.isArray(p.position) && Array.isArray(p.target))
            setCamClip(made.id, {
              view: {
                position: v3(p.position, 'position'),
                target: v3(p.target, 'target'),
                fov: num(p.fov) ?? st().settings.fov
              }
            })
          if (p.subject !== undefined) setCamClip(made.id, { subject: p.subject ? objectById(p.subject).id : null })
        }
        break
      }
      case 'preset': {
        inAnimation()
        const preset = [...STARTER_PRESETS, ...usePresets.getState().presets].find(
          (x) => x.id === p.preset || x.name.toLowerCase() === String(p.preset).toLowerCase()
        )
        if (!preset) throw new Error('Unknown preset. See get_options animationPresets.')
        applyPreset(preset, objectId())
        break
      }
      case 'clear': {
        inAnimation()
        // id "camera" is the camera row; block removes just that one block.
        const row = p.id === 'camera' ? CAMERA : objectId()
        const clips =
          row === CAMERA
            ? (animationOf().camera?.clips ?? [])
            : (animationOf().tracks.find((t) => t.objectId === row)?.clips ?? [])
        if (p.block) {
          if (!clips.some((c) => c.id === p.block)) throw new Error('No such block on that row')
          deleteClip(row, String(p.block))
        } else if (row === CAMERA) for (const c of clips) deleteClip(CAMERA, c.id)
        else clearTrack(row)
        break
      }
      case 'seek':
        inAnimation()
        seek(Math.max(0, num(p.time) ?? 0))
        break
      default:
        throw new Error('Unknown action')
    }
    if (action !== 'get') say(`animation: ${action}`)
    return summary()
  },

  export_glb: async (p) => {
    inAnimation()
    const { bytes, name } = await glbBytes(objectById(p.id).id)
    say(`exported ${name} for Blender`)
    return { file: { base64: toBase64(bytes), ext: '.glb', name } }
  },

  export_animation: async (p) => {
    inAnimation()
    const s = st().settings
    const size = EXPORT_SIZES.find((x) => x.id === (str(p.size) ?? 'thumb'))?.size ?? [s.exportWidth, s.exportHeight]
    let ext = ''
    let bytes: Uint8Array | null = null
    say('rendering the animation…')
    await exportAnimation(
      {
        kind: (str(p.kind) ?? 'video') as ExportKind,
        width: size[0],
        height: size[1],
        blur: Math.max(1, Math.min(16, num(p.motion_blur) ?? 1)),
        follow: str(p.follow) ? objectById(p.follow).id : null
      },
      ({ frame, frames }) => say(`rendering the animation, frame ${frame} of ${frames}`),
      {
        choose: async (_name, e) => ((ext = `.${e}`), 'claude'),
        write: async (b) => ((bytes = b), 'claude')
      }
    )
    if (!bytes) throw new Error('The animation was not rendered')
    say('exported the animation')
    return {
      width: size[0],
      height: size[1],
      file: { base64: toBase64(bytes), ext, name: st().project.name || 'animation' }
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/**
 * Waits for the scene to finish building. Unlike sceneSettled it doesn't count animation frames, which stop while
 * the window is minimised or covered (Claude often works while the user looks at something else).
 */
async function settled(): Promise<void> {
  const until = performance.now() + 30_000
  let quiet = 0
  while (quiet < 3 && performance.now() < until) {
    await sleep(80)
    quiet = building.count === 0 ? quiet + 1 : 0
  }
}

/** Starts answering Claude (call once when the app starts). */
export function startClaudeBridge(): () => void {
  return window.blockframe.onClaudeRequest(async (method, params) => {
    const h = handlers[method]
    if (!h) throw new Error(`ThumbCraft doesn't know "${method}" (is the app up to date?)`)
    if (!viewport.capture && method !== 'get_options')
      throw new Error('ThumbCraft is still starting; try again in a moment')
    return h(params)
  })
}

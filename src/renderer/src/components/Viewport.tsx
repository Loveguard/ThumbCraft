import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, TransformControls } from '@react-three/drei'
import { Component, memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { fullPose, PLAYER_PIXEL, type PartName } from '@shared/minecraft/playerModel'
import { assetContext } from '../minecraft/assets'
import { applyEquipment } from '../minecraft/equipment'
import { goboTexture } from '../minecraft/gobos'
import { limbEnd, limbGeometry, limbOf, LOWER, solveLimb, type Limb } from '../minecraft/ik'
import { loadModel } from '../minecraft/models3d'
import { guardReflector } from '../minecraft/waterReflection'
import { glowStrength } from '../minecraft/lighting'
import { mediaStore } from '../media'
import { composerHandle, Effects, renderFrame, sunDirection } from './Effects'
import { FocusPoints } from './FocusPoints'
import { Rulers, rulerBridge, type ScreenRect } from './Rulers'
import { StickerLayer } from './StickerLayer'
import { SkyBackdrop } from './SkyBackdrop'
import { snapPoint } from './snapping'
import { ViewportOverlay } from './ViewportOverlay'
import { Timeline } from './Timeline'
import { AppErrorBoundary } from './AppErrorBoundary'
import { ActionRing } from './ActionRing'
import { buildBlockEntities, hasBlockEntities } from '../minecraft/blockEntities'
import { applyMobPose, buildMob, mobModels } from '../minecraft/mobs'
import { animationLength, PathCurve, sampleTrack } from '@shared/animation'
import {
  addClipPoint,
  adoptViewportView,
  animationTick,
  beginEdit,
  canWalk,
  clipOf,
  drawWalk,
  dropPoint,
  finishEdit,
  goTo,
  setClipReach,
  setPathPoint,
  stateAt,
  useAnim
} from '../animation'
import {
  applyPose,
  buildPixelText,
  buildPlayer,
  buildNameTag,
  buildTerrain,
  disposeObject,
  jointOf,
  textCanvas
} from '../minecraft/builders'
import { useShallow } from 'zustand/react/shallow'
import {
  cameraBridge,
  NO_EQUIPMENT,
  selection,
  terrainStore,
  useStore,
  type CameraState,
  type ImageObject,
  type LightObject,
  type LightningObject,
  type MirrorObject,
  type MobObject,
  type ModelObject,
  type PixelTextObject,
  type PlayerObject,
  type SceneObject,
  type TerrainObject,
  type TextObject,
  type Vec3
} from '../store'
import { ensureFont } from '../textStyles'
import { LIGHTNING_ALPHA, lightningGeometry } from '@shared/minecraft/lightning'
import { Weather } from './Weather'
import { VfxNode } from './VfxNode'
import { errorText } from '../errors'
import { isLit, lightingOf } from '../renderModes'
import { HELPER_LAYER, OVERLAY_LAYER, setLayer, syncOverlay } from '../overlay'

export interface Placement {
  /** A spot in front of the camera, on the ground under the centre of the view. */
  point: THREE.Vector3
  /** Y rotation in degrees that makes a +Z-facing object look at the camera. */
  faceCameraYaw: number
}

/** Live handles used by panels (placement, push/pull along view axis) and by export. */
export const viewport: {
  camera: THREE.PerspectiveCamera | null
  capture: ((w: number, h: number) => string) | null
  /**
   * The frame at w×h once for each list of object ids, with those objects (and their lights) hidden. Every render
   * uses the same effect time, so the only differences are the objects.
   */
  captureStates: ((w: number, h: number, states: string[][]) => ImageData[]) | null
  /**
   * Renders frame after frame at w×h (a video): `draw` renders the scene as it is now into `g`, advancing animated
   * effects (grain…) by `delta` seconds; `end` puts the viewport back.
   */
  frames: ((w: number, h: number) => { draw(g: CanvasRenderingContext2D, delta: number): void; end(): void }) | null
  /** `radius`: rough size of the new thing in blocks, so big builds land further away. */
  placement: ((radius?: number) => Placement) | null
  objects: Map<string, THREE.Object3D>
  controls: { target: THREE.Vector3; update(): void } | null
  /** DOM element of the floating selection toolbar, positioned every frame. */
  selectionToolbar: HTMLElement | null
  /** The move/turn/size handles; `axis` is set while the pointer is over one. */
  gizmo: { axis: string | null } | null
} = {
  camera: null,
  capture: null,
  captureStates: null,
  frames: null,
  placement: null,
  objects: new Map(),
  controls: null,
  selectionToolbar: null,
  gizmo: null
}

const isHelperObject = (o: THREE.Object3D): boolean => {
  const flags = o as { isTransformControls?: boolean; isTransformControlsRoot?: boolean }
  return !!(o.userData.helper || flags.isTransformControls || flags.isTransformControlsRoot)
}

const deg = THREE.MathUtils.degToRad

/** How many scene objects are still being built (terrain meshing, skins, models…), so a capture can wait for them. */
export const building = { count: 0 }

/**
 * Runs an async builder when its inputs change. `dispose` frees a result once it has been replaced on screen
 * (or the node unmounts), and frees results that arrive after they were no longer wanted.
 */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[], dispose?: (v: NonNullable<T>) => void): T | null {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    building.count++
    fn()
      .then(
        (r) => {
          if (alive) setV(() => r)
          else if (r) dispose?.(r as NonNullable<T>)
        },
        (e) => console.error(e)
      )
      .finally(() => building.count--)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(
    () => () => {
      if (v) dispose?.(v as NonNullable<T>)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v]
  )
  return v
}

// The terrain atlas is cached and shared between rebuilds, so terrain frees everything but textures.
const disposeTerrain = (g: THREE.Object3D): void => disposeObject(g, false)

function TerrainNode({ o }: { o: TerrainObject }): ReactNode {
  const assets = useStore((s) => s.assets)
  const { ambientOcclusion, waterReflections } = useStore((s) => s.settings)
  // Terrain only cares whether the mode is lit, so switching between lit looks doesn't rebuild it.
  const lit = useStore((s) => isLit(s.settings.renderMode))
  const group = useAsync(
    async () => {
      const ctx = assetContext(assets)
      const t = terrainStore.get(o.terrainId)
      if (!ctx || !t) return null
      const before = ctx.resolver.failed.size
      try {
        const group = await buildTerrain(ctx, t, {
          ambientOcclusion,
          cinematic: lit,
          waterReflections
        })
        if (!group.children.length)
          useStore
            .getState()
            .setStatus(
              `${o.name} has no blocks to draw (${t.palette.length} block types, ${t.sizeX}×${t.sizeY}×${t.sizeZ}` +
                `${ctx.resolver.failed.size ? `; unreadable: ${[...ctx.resolver.failed].slice(0, 6).join(', ')}` : ''})`
            )
        else if (ctx.resolver.failed.size > before)
          useStore
            .getState()
            .setStatus(`Some blocks in ${o.name} couldn't be drawn: ${[...ctx.resolver.failed].slice(0, 6).join(', ')}`)
        return group
      } catch (e) {
        useStore.getState().setStatus(`Couldn't draw ${o.name}: ${errorText(e)}`)
        throw e
      }
    },
    [assets, o.terrainId, lit, ambientOcclusion, waterReflections],
    disposeTerrain
  )
  // Chests and signs come from the game's entity models, which may still be loading: the terrain shows first.
  const extras = useAsync(
    async () => {
      const t = terrainStore.get(o.terrainId)
      return t && hasBlockEntities(t) ? buildBlockEntities(t) : null
    },
    [o.terrainId, assets?.stamp],
    disposeObject
  )
  const t = terrainStore.get(o.terrainId)
  return group ? (
    <>
      <primitive object={group} />
      {extras && t && <primitive object={extras} position={[-t.sizeX / 2, 0, -t.sizeZ / 2]} />}
    </>
  ) : null
}

function PlayerNode({ o }: { o: PlayerObject }): ReactNode {
  const assets = useStore((s) => s.assets)
  const player = useAsync(() => buildPlayer(o.skinUrl, o.slim), [o.skinUrl, o.slim], disposeObject)
  useEffect(() => {
    if (player) applyPose(player, o.pose)
  }, [player, o.pose])
  const eq = o.equipment
  useEffect(() => {
    const ctx = assetContext(assets)
    if (!player || !ctx) return
    let alive = true
    applyEquipment(player, eq ?? NO_EQUIPMENT, o.slim, ctx, () => alive).catch((e: Error) =>
      useStore.getState().setStatus(`Couldn't add armor or items: ${e.message}`)
    )
    return () => {
      alive = false
    }
  }, [player, eq, o.slim, assets])
  const tag = useAsync(
    () => (o.nameTag ? buildNameTag(o.name) : Promise.resolve(null)),
    [o.nameTag, o.name],
    (s) => {
      s.material.map?.dispose()
      s.material.dispose()
    }
  )
  if (!player) return null
  return (
    <>
      <primitive object={player} />
      {tag && <primitive object={tag} />}
    </>
  )
}

function MobNode({ o }: { o: MobObject }): ReactNode {
  const stamp = useStore((s) => s.assets?.stamp)
  const mob = useAsync(
    async () => {
      const layer = (await mobModels()).layers[o.layer]
      return layer ? buildMob(layer, o.texture, o.layer) : null
    },
    [o.layer, o.texture, stamp],
    disposeObject
  )
  useEffect(() => {
    if (mob) applyMobPose(mob, o.partRotations)
  }, [mob, o.partRotations])
  return mob ? <primitive object={mob} /> : null
}

function overlayMaterialProps(onTop: boolean): Partial<THREE.MeshBasicMaterialParameters> {
  // Always both values: leaving them out when switching back would keep the old "on top" settings on the
  // live material (the renderer doesn't reset props that disappear).
  return { depthTest: !onTop, depthWrite: !onTop }
}

/** Frees a picture's or video's texture; a video also stops playing (it would keep decoding unseen). */
function disposeTexture(t: THREE.Texture): void {
  const video = (t as THREE.VideoTexture).isVideoTexture ? (t.image as HTMLVideoElement | undefined) : undefined
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  t.dispose()
}

function ImageNode({ o, order }: { o: ImageObject; order: number }): ReactNode {
  const texture = useAsync(
    async () => {
      if (o.kind === 'video') {
        const v = document.createElement('video')
        v.src = o.url
        v.loop = true
        v.muted = true
        v.playsInline = true
        await v.play().catch(() => undefined)
        const t = new THREE.VideoTexture(v)
        t.colorSpace = THREE.SRGBColorSpace
        return t
      }
      const t = await new THREE.TextureLoader().loadAsync(o.url)
      t.colorSpace = THREE.SRGBColorSpace
      if (o.pixelated) {
        t.magFilter = THREE.NearestFilter
        t.minFilter = THREE.NearestFilter
        t.generateMipmaps = false
      }
      return t
    },
    [o.url, o.kind, o.pixelated],
    disposeTexture
  )
  if (!texture) return null
  const h = 4
  return (
    <mesh renderOrder={o.onTop ? 1000 + order : 0}>
      <planeGeometry args={[h * o.aspect, h]} />
      <meshBasicMaterial
        map={texture}
        color={o.tint ?? '#ffffff'}
        transparent
        opacity={o.opacity}
        alphaTest={0.01}
        side={THREE.DoubleSide}
        toneMapped={false}
        {...overlayMaterialProps(o.onTop)}
      />
    </mesh>
  )
}

function TextNode({ o, order }: { o: TextObject; order: number }): ReactNode {
  // Redraw once the font has loaded (bundled fonts load on first use; imported ones come from the project).
  const [fontReady, setFontReady] = useState(0)
  useEffect(() => {
    let live = true
    void ensureFont(o).then(() => live && setFontReady((n) => n + 1))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.font, o.fontMediaId])
  const { texture, aspect } = useMemo(() => {
    const c = textCanvas(o)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return { texture: t, aspect: c.width / c.height }
    // Only the text's look matters; moving or scaling it must not redraw and re-upload the texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    o.text,
    o.color,
    o.outlineColor,
    o.outlineWidth,
    o.font,
    o.fontMediaId,
    o.shadow,
    o.gradient,
    o.outline2Color,
    o.outline2Width,
    o.glow,
    fontReady
  ])
  useEffect(() => () => texture.dispose(), [texture])
  const h = 1.6 * o.text.split('\n').length
  return (
    <mesh renderOrder={o.onTop ? 1000 + order : 0}>
      <planeGeometry args={[h * aspect, h]} />
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.01}
        side={THREE.DoubleSide}
        toneMapped={false}
        {...overlayMaterialProps(o.onTop)}
      />
    </mesh>
  )
}

function PixelTextNode({ o }: { o: PixelTextObject }): ReactNode {
  const stamp = useStore((s) => s.assets?.stamp)
  const g = useAsync(
    () => buildPixelText(o.text, o.color, o.depth, o.shadow, o.style),
    [o.text, o.color, o.depth, o.shadow, o.style, stamp],
    disposeObject
  )
  return g ? <primitive object={g} /> : null
}

/** Bulb/cone marker so a light can be seen and clicked; hidden in exports like other helpers. */
function LightMarker({ o }: { o: LightObject }): ReactNode {
  return (
    <group userData={{ helper: true }}>
      <mesh>
        <sphereGeometry args={[0.18, 12, 8]} />
        <meshBasicMaterial color={o.color} toneMapped={false} />
      </mesh>
      {o.lightType === 'spot' && (
        // A cone with its tip on the bulb, opening along +Z where the spotlight points.
        <mesh position={[0, 0, 0.35]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[Math.tan(deg(Math.min(o.angle, 120) / 2)) * 0.7, 0.7, 16, 1, true]} />
          <meshBasicMaterial color={o.color} wireframe transparent opacity={0.6} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

function MirrorNode({ o }: { o: MirrorObject }): ReactNode {
  const mirror = useMemo(() => {
    const r = new Reflector(new THREE.PlaneGeometry(o.width, o.height), {
      // Longest side 1024 px, whatever the mirror's shape.
      textureWidth: Math.round(1024 * Math.min(1, o.width / o.height)),
      textureHeight: Math.round(1024 * Math.min(1, o.height / o.width)),
      color: new THREE.Color(o.tint),
      clipBias: 0.003
    })
    r.position.y = o.height / 2
    guardReflector(r)
    return r
  }, [o.width, o.height, o.tint])
  useEffect(() => () => mirror.dispose(), [mirror])
  const t = 0.12
  return (
    <>
      <primitive object={mirror} />
      {o.frame && (
        // A dark wooden frame around the glass.
        <group position={[0, o.height / 2, -t / 2]}>
          {[
            [0, o.height / 2 + t / 2, o.width + 2 * t, t],
            [0, -o.height / 2 - t / 2, o.width + 2 * t, t],
            [-o.width / 2 - t / 2, 0, t, o.height],
            [o.width / 2 + t / 2, 0, t, o.height]
          ].map(([x, y, w, h], i) => (
            <mesh key={i} position={[x, y, 0]} castShadow receiveShadow>
              <boxGeometry args={[w, h, t * 2]} />
              <meshStandardMaterial color="#3b2615" roughness={0.8} />
            </mesh>
          ))}
        </group>
      )}
    </>
  )
}

function ModelNode({ o }: { o: ModelObject }): ReactNode {
  const key = [o.mediaId, ...o.extraMediaIds].join('|')
  const model = useAsync(
    async () => {
      const main = mediaStore.get(o.mediaId)
      if (!main) return null
      const extras = o.extraMediaIds.flatMap((id) => mediaStore.get(id) ?? [])
      return loadModel(main, extras).catch((e: Error) => {
        useStore.getState().setStatus(`Couldn't load ${main.name}: ${e.message}`)
        return null
      })
    },
    [key],
    disposeObject
  )
  return model ? <primitive object={model} /> : null
}

/** A vanilla lightning bolt: additive glowing quads, plus an optional flash lighting the strike point. */
function LightningNode({ o }: { o: LightningObject }): ReactNode {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(lightningGeometry(o.seed, o.thickness ?? 1), 3))
    g.computeBoundingSphere()
    return g
  }, [o.seed, o.thickness])
  useEffect(() => () => geometry.dispose(), [geometry])
  const color = useMemo(() => new THREE.Color(o.color).multiplyScalar(o.brightness), [o.color, o.brightness])
  return (
    <>
      <mesh geometry={geometry} renderOrder={600}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={LIGHTNING_ALPHA}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {o.flash && (
        // A gentler flash than before: enough to light the ground and nearby players without whiting them out.
        <pointLight position={[0, 3, 0]} color="#d6dcff" intensity={45 * o.brightness} distance={30} decay={2} />
      )}
    </>
  )
}

function LightNode({ o }: { o: LightObject }): ReactNode {
  const custom = useAsync(
    async () => {
      const m = o.gobo === 'custom' && o.goboMediaId ? mediaStore.get(o.goboMediaId) : null
      if (!m) return null
      const t = await new THREE.TextureLoader().loadAsync(m.url)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    },
    [o.gobo, o.goboMediaId],
    disposeTexture
  )
  const map = o.lightType === 'spot' && o.gobo ? (o.gobo === 'custom' ? custom : goboTexture(o.gobo)) : null
  // three.js only projects a spotlight pattern through its shadow map.
  const shadows = o.shadows || !!map
  const target = useMemo(() => {
    const t = new THREE.Object3D()
    t.position.set(0, 0, 1)
    return t
  }, [])
  return (
    <>
      {o.lightType === 'point' ? (
        <pointLight
          color={o.color}
          intensity={o.intensity}
          distance={o.range}
          decay={2}
          castShadow={shadows}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.002}
        />
      ) : (
        <spotLight
          key={map ? map.uuid : 'plain'} // a new map needs a recompiled shader
          color={o.color}
          intensity={o.intensity}
          distance={o.range}
          decay={2}
          angle={deg(o.angle / 2)}
          penumbra={o.softness}
          target={target}
          map={map}
          castShadow={shadows}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
        />
      )}
      <primitive object={target} />
      <LightMarker o={o} />
    </>
  )
}

/**
 * Where the last press happened. A release far from it ends a drag (a gizmo, the camera), which must not
 * change the selection: only a real click picks another object or clears it.
 */
const press = { x: 0, y: 0 }
if (typeof window !== 'undefined')
  window.addEventListener('pointerdown', (e) => Object.assign(press, { x: e.clientX, y: e.clientY }), true)
const wasDrag = (e: MouseEvent): boolean => Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4

const ObjectNode = memo(function ObjectNode({ o, order }: { o: SceneObject; order: number }): ReactNode {
  const select = useStore((s) => s.select)
  const cinematic = useStore((s) => isLit(s.settings.renderMode))
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    if (ref.current) viewport.objects.set(o.id, ref.current)
    return () => void viewport.objects.delete(o.id)
  }, [o.id])
  // Flat images and text handle "on top" in their own material; 3D objects go through the overlay pass.
  const overlay = o.kind !== 'image' && o.kind !== 'video' && o.kind !== 'text'
  const onTop = overlay && !!o.onTop
  const flat = overlay && !!o.flat
  const overlaid = useRef(false)
  // With clean layers on, on-top objects (titles included) are drawn after the effects, untouched by them.
  const cleanLayers = useStore((s) => s.effects.cleanOverlays)
  const lifted = !!o.onTop && cleanLayers
  const layered = useRef(false)
  useFrame(() => {
    if (!ref.current) return
    // Every frame while active, so parts that finish loading later (skins, textures) are included too.
    if (onTop || flat || overlaid.current) {
      syncOverlay(ref.current, onTop, flat, order)
      overlaid.current = onTop || flat
    }
    if (lifted || layered.current) {
      setLayer(ref.current, lifted ? OVERLAY_LAYER : 0)
      layered.current = lifted
    }
  })
  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation()
    if (wasDrag(e.nativeEvent)) return
    // Ctrl or Shift+click adds to the selection (or takes it out).
    const { ctrlKey, metaKey, shiftKey } = e.nativeEvent
    if (ctrlKey || metaKey || shiftKey) {
      useStore.getState().toggleSelect(o.id)
      return
    }
    // On an already-selected player, clicking a limb picks that joint for rotating.
    const { selectedId, selectJoint } = useStore.getState()
    if (o.kind === 'player' && selectedId === o.id) {
      // a smooth limb is one mesh over two joints: the half that was hit decides
      let joint = jointOf(e.object)
      const lower = e.object.userData.lowerJoint as PartName | undefined
      if (lower && joint) {
        const bone = e.object.parent?.getObjectByName(lower)
        if (bone && bone.worldToLocal(e.point.clone()).y < 0) joint = lower
      }
      selectJoint(joint)
    } else select(o.id)
  }
  return (
    <group
      ref={ref}
      visible={o.visible}
      position={o.position}
      rotation={[deg(o.rotation[0]), deg(o.rotation[1]), deg(o.rotation[2])]}
      scale={o.scale}
      onClick={onClick}
    >
      {o.kind === 'terrain' && <TerrainNode o={o} />}
      {o.kind === 'player' && <PlayerNode o={o} />}
      {o.kind === 'mob' && <MobNode o={o} />}
      {(o.kind === 'image' || o.kind === 'video') && <ImageNode o={o} order={order} />}
      {o.kind === 'text' && <TextNode o={o} order={order} />}
      {o.kind === 'pixelText' && <PixelTextNode o={o} />}
      {o.kind === 'light' && <LightNode o={o} />}
      {o.kind === 'model' && <ModelNode o={o} />}
      {o.kind === 'mirror' && <MirrorNode o={o} />}
      {o.kind === 'lightning' && <LightningNode o={o} />}
      {o.kind === 'vfx' && <VfxNode o={o} cinematic={cinematic} />}
    </group>
  )
})

function Environment(): ReactNode {
  const { renderMode, sunAzimuth, sunElevation, sunStrength, ambientStrength } = useStore((s) => s.settings)
  const sunPos = useMemo(
    () => sunDirection(sunAzimuth, sunElevation).multiplyScalar(60).toArray() as [number, number, number],
    [sunAzimuth, sunElevation]
  )

  const blockGlow = useStore((s) => s.settings.blockGlow)
  useEffect(() => {
    glowStrength.value = blockGlow
  }, [blockGlow])
  const custom = useStore((s) => s.settings.customLighting)
  const lit = lightingOf(renderMode, custom)
  const sun = lit ? sunStrength : 1
  const fill = lit ? ambientStrength : 1
  return (
    <>
      <ambientLight intensity={(lit ? lit.ambient : 1.6) * fill} />
      {lit && lit.hemisphere > 0 && <hemisphereLight args={[lit.skyColor, lit.groundColor, lit.hemisphere * fill]} />}
      {/* Vanilla lights entities with two fixed directional lights; the lit modes add a shadow-casting sun. */}
      <directionalLight
        position={sunPos}
        color={lit ? lit.sunColor : '#ffffff'}
        intensity={(lit ? lit.sun : 1.2) * sun}
        castShadow={!!lit && sun > 0}
        shadow-mapSize={[2048, 2048]}
        shadow-radius={lit?.shadowSoftness ?? 1}
      >
        <orthographicCamera attach="shadow-camera" args={[-48, 48, 48, -48, 0.5, 300]} />
      </directionalLight>
      <directionalLight position={[-2, 10, -7]} intensity={(lit ? lit.fill : 0.8) * fill} />
    </>
  )
}

let cameraMove: { before: CameraState | null; at: number } | null = null

/**
 * Shadows depend on the scene and lights, not on the camera: skip redrawing shadow maps while the user only
 * orbits/pans/zooms, and refresh them as soon as the move ends (or anything else changes).
 */
function ShadowThrottle(): null {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => void (gl.shadowMap.autoUpdate = true)
  }, [gl])
  useFrame(() => {
    if (!cameraMove) gl.shadowMap.needsUpdate = true
  })
  return null
}

function Bridge(): null {
  const { gl, scene, camera, size, raycaster } = useThree()
  // Clicking still selects objects drawn on the clean overlay layer.
  useEffect(() => void raycaster.layers.enable(OVERLAY_LAYER), [raycaster])
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null
  useEffect(() => {
    viewport.camera = camera as THREE.PerspectiveCamera
    viewport.controls = (controls as unknown as typeof viewport.controls) ?? null
    cameraBridge.get = () =>
      viewport.controls
        ? { position: camera.position.toArray(), target: viewport.controls.target.toArray() as Vec3 }
        : null
    cameraBridge.set = (c) => {
      camera.position.fromArray(c.position)
      viewport.controls?.target.fromArray(c.target)
      viewport.controls?.update()
    }
    viewport.placement = (radius = 1) => {
      // New things go in front of the camera at a comfortable distance (further for big builds): on what the
      // view centre hits if that's near enough, otherwise on the ground below a point along the view.
      const near = Math.max(3, radius * 2.4)
      const far = Math.max(12, radius * 5)
      const want = Math.max(5, radius * 3)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(0, 0), camera)
      ray.far = 500
      const targets: THREE.Object3D[] = []
      for (const o of viewport.objects.values()) if (o.visible) targets.push(o)
      const visibleHit = (hits: THREE.Intersection[]): THREE.Intersection | undefined =>
        hits.find((h) => {
          for (let p: THREE.Object3D | null = h.object; p; p = p.parent)
            if (isHelperObject(p) || !p.visible) return false
          return true
        })
      const hit = visibleHit(ray.intersectObjects(targets, true))
      let point: THREE.Vector3
      if (hit && hit.distance >= near && hit.distance <= far) {
        point = hit.point.clone()
        const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld)
        // A wall or ceiling: step back out of it before dropping to the floor below.
        if (normal && normal.y < 0.7) point.addScaledVector(normal, 0.6)
      } else point = ray.ray.at(hit && hit.distance < near ? near : want, new THREE.Vector3())
      // Stand on whatever is below that spot (if there is anything within reach).
      const down = new THREE.Raycaster(
        point.clone().add(new THREE.Vector3(0, 0.1, 0)),
        new THREE.Vector3(0, -1, 0),
        0,
        64
      )
      const floor = visibleHit(down.intersectObjects(targets, true))
      if (floor) point = floor.point.clone()
      else if (!hit) point.y = Math.min(point.y, camera.position.y - 1.5)
      const yaw = Math.atan2(camera.position.x - point.x, camera.position.z - point.z)
      return { point, faceCameraYaw: Math.round(THREE.MathUtils.radToDeg(yaw)) }
    }
    /** Hides the gizmos and guides for a capture; returns them so they can be shown again. */
    const hideHelpers = (): THREE.Object3D[] => {
      const helpers: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (isHelperObject(o) && o.visible) {
          helpers.push(o)
          o.visible = false
        }
      })
      return helpers
    }
    /** Sizes the renderer (through the effect chain when there is one) and the camera for a capture. */
    const resize = (composer: typeof composerHandle.current, width: number, height: number, ratio: number): void => {
      const cam = camera as THREE.PerspectiveCamera
      gl.setPixelRatio(ratio)
      if (composer) composer.setSize(width, height, false)
      else gl.setSize(width, height, false)
      cam.aspect = width / height
      cam.updateProjectionMatrix()
    }
    viewport.capture = (w, h) => {
      const cam = camera as THREE.PerspectiveCamera
      const helpers = hideHelpers()
      const prevRatio = gl.getPixelRatio()
      const composer = composerHandle.current
      // Render once at the export size, through the post-processing chain when effects are on.
      const renderAt = (width: number, height: number, ratio: number): void => {
        resize(composer, width, height, ratio)
        renderFrame(gl, scene, cam, composer)
      }
      try {
        renderAt(w, h, 1)
        return gl.domElement.toDataURL('image/png')
      } finally {
        // Also when the render fails: the gizmos come back and the viewport returns to its own size.
        helpers.forEach((o) => (o.visible = true))
        renderAt(size.width, size.height, prevRatio)
      }
    }
    viewport.captureStates = (w, h, states) => {
      const cam = camera as THREE.PerspectiveCamera
      const helpers = hideHelpers()
      const prevRatio = gl.getPixelRatio()
      const composer = composerHandle.current
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g = canvas.getContext('2d', { willReadFrequently: true })!
      try {
        resize(composer, w, h, 1)
        return states.map((ids) => {
          const hidden = ids.map((id) => viewport.objects.get(id)).filter((o) => o?.visible) as THREE.Object3D[]
          hidden.forEach((o) => (o.visible = false))
          try {
            // Effect time stays put (delta 0), so film grain is identical in every pass.
            renderFrame(gl, scene, cam, composer, false, 0)
            g.clearRect(0, 0, w, h)
            g.drawImage(gl.domElement, 0, 0, w, h)
            return g.getImageData(0, 0, w, h)
          } finally {
            hidden.forEach((o) => (o.visible = true))
          }
        })
      } finally {
        helpers.forEach((o) => (o.visible = true))
        resize(composer, size.width, size.height, prevRatio)
        renderFrame(gl, scene, cam, composer)
      }
    }
    viewport.frames = (w, h) => {
      const cam = camera as THREE.PerspectiveCamera
      const helpers = hideHelpers()
      const prevRatio = gl.getPixelRatio()
      const composer = composerHandle.current
      const setSize = resize.bind(null, composer)
      setSize(w, h, 1)
      return {
        draw: (g, delta) => {
          // Things move between frames, so their shadows must follow.
          gl.shadowMap.needsUpdate = true
          scene.updateMatrixWorld()
          renderFrame(gl, scene, cam, composer, false, delta)
          g.drawImage(gl.domElement, 0, 0, w, h)
        },
        end: () => {
          helpers.forEach((o) => (o.visible = true))
          setSize(size.width, size.height, prevRatio)
          renderFrame(gl, scene, cam, composer)
        }
      }
    }
  }, [gl, scene, camera, size, controls])
  return null
}

function FovSync(): null {
  const fov = useStore((s) => s.settings.fov)
  const { camera } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = fov
    cam.updateProjectionMatrix()
  }, [camera, fov])
  return null
}

/** Latest pointer position over the canvas (NDC) and whether Shift is held. */
const pointer = { ndc: new THREE.Vector2(), shift: false }

function PointerTracker(): null {
  const { gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const move = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect()
      pointer.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      pointer.shift = e.shiftKey
    }
    const key = (e: KeyboardEvent): void => void (pointer.shift = e.shiftKey)
    el.addEventListener('pointermove', move)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    return () => {
      el.removeEventListener('pointermove', move)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
    }
  }, [gl])
  return null
}

/** The screen area a box covers, in fractions of the frame (y down); null when it's behind the camera. */
function screenRect(box: THREE.Box3, camera: THREE.Camera, v: THREE.Vector3): ScreenRect | null {
  const r = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
    v.project(camera)
    if (v.z > 1) return null
    const x = (v.x + 1) / 2
    const y = (1 - v.y) / 2
    r.x0 = Math.min(r.x0, x)
    r.x1 = Math.max(r.x1, x)
    r.y0 = Math.min(r.y0, y)
    r.y1 = Math.max(r.y1, y)
  }
  return r
}

/**
 * Says when something measured from scene objects (a box around them, their centre) has to be measured again:
 * one of them moved, the scene changed, something is still being built, or a third of a second has passed.
 * Measuring walks every part of the object, which is too much to do on every frame for nothing.
 */
class MeasureWatch {
  private last: number[] = []
  private scene: unknown = null
  private frames = 0
  changed(roots: (THREE.Object3D | null | undefined)[]): boolean {
    const scene = useStore.getState().objects
    let changed = scene !== this.scene || building.count > 0 || ++this.frames >= 20
    this.scene = scene
    let i = 0
    for (const root of roots) {
      const e = root?.matrixWorld.elements
      for (let k = 0; k < 16; k++, i++) {
        const v = e ? e[k] : NaN
        if (!Object.is(this.last[i], v)) {
          this.last[i] = v
          changed = true
        }
      }
    }
    if (this.last.length !== i) {
      this.last.length = i
      changed = true
    }
    if (changed) this.frames = 0
    return changed
  }
}

/** Keeps the floating selection toolbar just above the selected object on screen (and the rulers' selection marks). */
function SelectionTracker(): null {
  const ids = useStore(useShallow((s) => selection(s)))
  const box = useMemo(() => new THREE.Box3(), [])
  const one = useMemo(() => new THREE.Box3(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const watch = useMemo(() => new MeasureWatch(), [])
  useFrame(({ camera, size }) => {
    const el = viewport.selectionToolbar
    const roots = ids.map((id) => viewport.objects.get(id))
    // Above everything selected, so it never sits on the group's handles.
    if (watch.changed(roots)) {
      box.makeEmpty()
      for (const obj of roots) if (obj?.visible) box.union(one.setFromObject(obj))
    }
    if (rulerBridge.update) rulerBridge.update(box.isEmpty() ? null : screenRect(box, camera, v))
    if (!el) return
    if (box.isEmpty()) {
      el.style.visibility = 'hidden'
      return
    }
    box.getCenter(v)
    v.y = box.max.y
    v.project(camera)
    const behind = v.z > 1
    const x = THREE.MathUtils.clamp(((v.x + 1) / 2) * size.width, 90, size.width - 90)
    const y = THREE.MathUtils.clamp(((1 - v.y) / 2) * size.height - 14, 50, size.height - 60)
    el.style.visibility = behind ? 'hidden' : 'visible'
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
  })
  return null
}

/** A handle on the hand or foot: dragging it solves the shoulder/hip and elbow/knee (two-bone IK). */
function IkGizmo({ id, limb, slim }: { id: string; limb: Limb; slim: boolean }): ReactNode {
  const objects = useStore((s) => s.objects)
  const geometry = useMemo(() => limbGeometry(limb, slim), [limb, slim])
  const [root, setRoot] = useState<THREE.Object3D | null>(null)
  useEffect(() => setRoot(viewport.objects.get(id)?.getObjectByName('player') ?? null), [id, objects])
  const handle = useMemo(() => {
    const h = new THREE.Object3D()
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#4ade80', depthTest: false, toneMapped: false })
    )
    dot.renderOrder = 999
    dot.userData.helper = true
    dot.layers.set(HELPER_LAYER)
    h.add(dot)
    return h
  }, [])
  const dragging = useRef(false)
  const pose = objects.find((o): o is PlayerObject => o.id === id && o.kind === 'player')?.pose
  useEffect(() => {
    if (!root) return
    root.add(handle)
    return () => void root.remove(handle)
  }, [root, handle])
  useEffect(() => {
    // Follow the limb (after undo, sliders…) unless the user is dragging the handle.
    if (!pose || dragging.current) return
    const p = fullPose(pose)
    handle.position.copy(limbEnd(geometry, p[limb], p[LOWER[limb]]).multiplyScalar(PLAYER_PIXEL))
  }, [pose, geometry, limb, handle])
  if (!root) return null
  const solve = (): { upper: number[]; lower: number[] } => {
    const r = solveLimb(limb, geometry, handle.position.clone().divideScalar(PLAYER_PIXEL))
    const d = THREE.MathUtils.degToRad
    root.getObjectByName(limb)?.rotation.set(d(r.upper[0]), d(r.upper[1]), d(r.upper[2]))
    root.getObjectByName(LOWER[limb])?.rotation.set(d(r.lower[0]), 0, 0)
    return r
  }
  return (
    <TransformControls
      object={handle}
      mode="translate"
      size={0.8}
      onMouseDown={() => (dragging.current = true)}
      onObjectChange={() => void solve()}
      onMouseUp={() => {
        dragging.current = false
        const o = useStore.getState().objects.find((x) => x.id === id)
        if (o?.kind !== 'player') return
        const r = solve()
        useStore.getState().update(id, {
          pose: { ...fullPose(o.pose), [limb]: r.upper as Vec3, [LOWER[limb]]: r.lower as Vec3 }
        })
      }}
    />
  )
}

/** Rotate handles on one joint of the selected player; dragging writes the joint's angles to its pose. */
function JointGizmo({ id, joint }: { id: string; joint: PartName }): ReactNode {
  const objects = useStore((s) => s.objects)
  const [target, setTarget] = useState<THREE.Object3D | null>(null)
  useEffect(() => setTarget(viewport.objects.get(id)?.getObjectByName(joint) ?? null), [id, joint, objects])
  if (!target) return null
  const commit = (): void => {
    const o = useStore.getState().objects.find((x) => x.id === id)
    if (o?.kind !== 'player') return
    const r = target.rotation
    const angles = [r.x, r.y, r.z].map((v) => Math.round(THREE.MathUtils.radToDeg(v) * 10) / 10) as [
      number,
      number,
      number
    ]
    useStore.getState().update(id, { pose: { ...fullPose(o.pose), [joint]: angles } })
  }
  return <TransformControls object={target} mode="rotate" space="local" size={0.6} onMouseUp={commit} />
}

/** Builds and terrain move the way blocks do, a whole block at a time; characters and the rest move freely. */
const movesByBlocks = (kind: string | undefined): boolean => kind === 'terrain' || kind === 'model'

/** The handles hold the pointer while one is hovered (so Shift+drag on a handle snaps instead of box-selecting). */
function useGizmoRegistry(controls: { current: unknown }): void {
  useEffect(() => {
    const c = controls.current as { axis: string | null } | null
    if (!c) return
    viewport.gizmo = c
    return () => {
      if (viewport.gizmo === c) viewport.gizmo = null
    }
  })
}

/**
 * Handles for several selected objects at once: they sit at the selection's centre, and moving, turning or
 * resizing them does the same to every object around that centre, as one undo step.
 *
 * Moving keeps the selection lined up as seen through the camera: an object further away moves further in the
 * world, by its distance over the centre's, so titles that look edge to edge stay edge to edge on screen even
 * when one is nearer the camera than the other.
 */
function GroupGizmo({ ids }: { ids: string[] }): ReactNode {
  const mode = useStore((s) => s.transformMode)
  const objects = useStore((s) => s.objects)
  const { scene } = useThree()
  const controls = useRef<ComponentRef<typeof TransformControls>>(null)
  useGizmoRegistry(controls)
  const pivot = useMemo(() => {
    const p = new THREE.Object3D()
    p.userData.helper = true
    return p
  }, [])
  const start = useRef<{
    inverse: THREE.Matrix4
    pivot: THREE.Vector3
    items: { id: string; obj: THREE.Object3D; m: THREE.Matrix4; pos: THREE.Vector3; depth: number }[]
  } | null>(null)
  useEffect(() => {
    scene.add(pivot)
    return () => void scene.remove(pivot)
  }, [scene, pivot])
  useEffect(() => {
    if (start.current) return
    const list = objects.filter((o) => ids.includes(o.id))
    if (!list.length) return
    const c = new THREE.Vector3()
    for (const o of list) c.add(new THREE.Vector3(...o.position))
    pivot.position.copy(c.divideScalar(list.length))
    pivot.rotation.set(0, 0, 0)
    pivot.scale.setScalar(1)
    pivot.updateMatrixWorld()
  }, [objects, ids, pivot])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const sc = useMemo(() => new THREE.Vector3(), [])
  return (
    <TransformControls
      ref={controls}
      object={pivot}
      mode={mode}
      showY
      onMouseDown={() => {
        pivot.updateMatrixWorld()
        const cam = viewport.camera
        const forward = new THREE.Vector3()
        cam?.getWorldDirection(forward)
        // Depth along the view, relative to the centre's (1 = as far as the centre).
        const depthOf = (p: THREE.Vector3): number => (cam ? p.clone().sub(cam.position).dot(forward) : 1)
        const centreDepth = depthOf(pivot.position)
        start.current = {
          inverse: pivot.matrixWorld.clone().invert(),
          pivot: pivot.position.clone(),
          items: ids.flatMap((id) => {
            const obj = viewport.objects.get(id)
            if (!obj) return []
            const d = centreDepth > 0.05 ? depthOf(obj.position) / centreDepth : 1
            return [{ id, obj, m: obj.matrix.clone(), pos: obj.position.clone(), depth: d > 0.05 ? d : 1 }]
          })
        }
      }}
      onObjectChange={() => {
        const st = start.current
        if (!st) return
        if (mode === 'scale') {
          // Uniform: follow whichever handle is being dragged.
          const s = pivot.scale
          s.setScalar([s.x, s.y, s.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a)))
        }
        if (mode === 'translate' && (pointer.shift || useStore.getState().settings.snap))
          for (const a of ['x', 'y', 'z'] as const) pivot.position[a] = Math.round(pivot.position[a] * 2) / 2
        else if (mode === 'translate' && ids.every((i) => movesByBlocks(objects.find((o) => o.id === i)?.kind)))
          for (const a of ['x', 'y', 'z'] as const)
            pivot.position[a] = st.pivot[a] + Math.round(pivot.position[a] - st.pivot[a])
        pivot.updateMatrixWorld()
        if (mode === 'translate') {
          const move = pivot.position.clone().sub(st.pivot)
          for (const it of st.items) it.obj.position.copy(it.pos).addScaledVector(move, it.depth)
          return
        }
        const delta = m.multiplyMatrices(pivot.matrixWorld, st.inverse)
        for (const it of st.items) {
          new THREE.Matrix4().multiplyMatrices(delta, it.m).decompose(it.obj.position, it.obj.quaternion, sc)
          it.obj.scale.setScalar(sc.x)
        }
      }}
      onMouseUp={() => {
        const st = start.current
        start.current = null
        if (!st) return
        const r = (v: number): number => Math.round(THREE.MathUtils.radToDeg(v) * 10) / 10
        useStore.getState().updateMany(
          st.items.map(({ id, obj }) => ({
            id,
            patch: {
              position: [obj.position.x, obj.position.y, obj.position.z] as Vec3,
              rotation: [r(obj.rotation.x), r(obj.rotation.y), r(obj.rotation.z)] as Vec3,
              scale: obj.scale.x
            }
          }))
        )
      }}
    />
  )
}

/** Outlines every selected object while more than one is selected. */
function SelectionBoxes(): ReactNode {
  const ids = useStore(useShallow((s) => selection(s)))
  const helpers = useMemo(
    () =>
      ids.length > 1
        ? ids.map(() => {
            const h = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#4ade80'))
            const mat = h.material as THREE.LineBasicMaterial
            mat.depthTest = false
            mat.transparent = true
            mat.opacity = 0.8
            h.renderOrder = 998
            h.userData.helper = true
            h.layers.set(HELPER_LAYER)
            return h
          })
        : [],
    [ids]
  )
  useEffect(
    () => () =>
      helpers.forEach((h) => {
        h.geometry.dispose()
        ;(h.material as THREE.Material).dispose()
      }),
    [helpers]
  )
  useFrame(() =>
    helpers.forEach((h, i) => {
      const o = viewport.objects.get(ids[i])
      if (o) h.box.setFromObject(o)
      h.visible = !!o && o.visible && !h.box.isEmpty()
    })
  )
  return (
    <>
      {helpers.map((h, i) => (
        <primitive key={ids[i]} object={h} />
      ))}
    </>
  )
}

/** Plays the animation (Animation mode). */
function AnimationDriver(): null {
  useFrame((_, delta) => animationTick(delta))
  return null
}

const PATH_COLOR = '#ffd23a'

/** A helper line that is never picked, never exported, and drawn over the scene. */
function helperLine(points: THREE.Vector3[], color: string, opacity = 1): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity })
  )
  line.renderOrder = 999
  line.userData.helper = true
  line.raycast = () => {}
  return line
}

/** Objects that move by themselves, so the view has to keep drawing. */
const LIVELY = new Set(['vfx', 'video', 'lightning'])

/**
 * Snappier when nothing happens: the view draws every frame while you work, while it plays and while anything moves
 * by itself (effects, videos, weather), and drops to a few frames a second a moment after you stop, which is
 * enough to catch textures that finish loading.
 */
function IdleFrameloop(): null {
  const { setFrameloop, invalidate } = useThree()
  const lively = useStore((s) => s.settings.weather !== 'none' || s.objects.some((o) => LIVELY.has(o.kind)))
  const playing = useAnim((s) => s.playing)
  useEffect(() => {
    if (lively || playing) {
      setFrameloop('always')
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const wake = (): void => {
      setFrameloop('always')
      clearTimeout(timer)
      timer = setTimeout(() => setFrameloop('demand'), 1500)
    }
    wake()
    const slow = setInterval(() => invalidate(), 250)
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const
    for (const e of events) window.addEventListener(e, wake, { passive: true })
    const stopScene = useStore.subscribe(wake)
    const stopAnim = useAnim.subscribe(wake)
    return () => {
      clearTimeout(timer)
      clearInterval(slow)
      for (const e of events) window.removeEventListener(e, wake)
      stopScene()
      stopAnim()
      setFrameloop('always')
    }
  }, [lively, playing, setFrameloop, invalidate])
  return null
}

/** A ray from the camera through the pointer. */
function pointerRay(e: MouseEvent, gl: THREE.WebGLRenderer, camera: THREE.Camera): THREE.Raycaster {
  const rect = gl.domElement.getBoundingClientRect()
  const r = new THREE.Raycaster()
  r.setFromCamera(
    new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
    camera
  )
  return r
}

/** The ground point under the pointer: the first thing hit that isn't `skip`, else the level `y`. */
function groundAt(
  e: MouseEvent,
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
  skip: string | null,
  y: number
): Vec3 | null {
  const r = pointerRay(e, gl, camera)
  const targets: THREE.Object3D[] = []
  for (const [id, o] of viewport.objects) if (id !== skip && o.visible) targets.push(o)
  const hit = r.intersectObjects(targets, true).find((h) => {
    for (let p: THREE.Object3D | null = h.object; p; p = p.parent) if (isHelperObject(p) || !p.visible) return false
    return true
  })
  const p = hit?.point ?? r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3())
  return p ? [p.x, p.y, p.z] : null
}

/**
 * Animation mode, the direct ways: with Draw a walk on, dragging across the ground draws the selected character a
 * walk there; clicking a character (without dragging) opens its quick actions next to it.
 */
function DrawAndRing(): ReactNode {
  const mode = useAnim((s) => s.mode)
  const drawing = useAnim((s) => s.drawing)
  const { gl, camera } = useThree()
  const [stroke, setStroke] = useState<Vec3[]>([])

  useEffect(() => {
    if (mode !== 'animation') return
    const el = gl.domElement.closest('.viewport') as HTMLElement | null
    if (!el) return
    let down: { x: number; y: number; selected: string | null } | null = null
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return
      down = { x: e.clientX, y: e.clientY, selected: useStore.getState().selectedId }
      const who = useStore.getState().objects.find((o) => o.id === useStore.getState().selectedId)
      if (!useAnim.getState().drawing || !who || !canWalk(who)) return
      // Drawing: the camera and the scene's own clicks never see this drag.
      e.stopPropagation()
      e.preventDefault()
      const pts: Vec3[] = []
      const add = (ev: PointerEvent): void => {
        const p = groundAt(ev, gl, camera, who.id, who.position[1])
        if (p && (!pts.length || Math.hypot(p[0] - pts.at(-1)![0], p[2] - pts.at(-1)![2]) > 0.25)) {
          pts.push(p)
          setStroke([...pts])
        }
      }
      add(e)
      const up = (): void => {
        window.removeEventListener('pointermove', add)
        window.removeEventListener('pointerup', up)
        setStroke([])
        useAnim.setState({ drawing: false })
        drawWalk(who.id, pts)
      }
      window.addEventListener('pointermove', add)
      window.addEventListener('pointerup', up)
    }
    const onUp = (e: PointerEvent): void => {
      const a = useAnim.getState()
      if (!down || a.drawing || a.addingPoints || a.pickingTarget || a.goingTo || a.playing) return
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !(e.target instanceof HTMLCanvasElement)) return
      const was = down.selected
      down = null
      // Which character is under the pointer, if any.
      const r = pointerRay(e, gl, camera)
      const people = useStore.getState().objects.filter(canWalk)
      let best: { id: string; d: number } | null = null
      for (const o of people) {
        const obj = viewport.objects.get(o.id)
        const hit = obj?.visible ? r.intersectObject(obj, true)[0] : undefined
        if (hit && (!best || hit.distance < best.d)) best = { id: o.id, d: hit.distance }
      }
      const box = el.getBoundingClientRect()
      // A second click on the character already picked is for its joints and handles, not for the actions.
      if (best?.id === was) return
      useAnim.setState({
        ring: best ? { id: best.id, x: e.clientX - box.left + 12, y: e.clientY - box.top - 12 } : null
      })
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
    }
  }, [mode, gl, camera])

  useEffect(() => {
    const el = gl.domElement.closest('.viewport') as HTMLElement | null
    if (!el || !drawing) return
    const prev = el.style.cursor
    el.style.cursor = 'crosshair'
    return () => void (el.style.cursor = prev)
  }, [drawing, gl])

  const line = useMemo(
    () =>
      stroke.length > 1
        ? helperLine(
            stroke.map((p) => new THREE.Vector3(p[0], p[1] + 0.06, p[2])),
            PATH_COLOR
          )
        : null,
    [stroke]
  )
  return line ? <primitive object={line} /> : null
}

/** With the Shorts size picked for export: the tall frame, and where YouTube's buttons and caption cover it. */
function ShortsGuide(): ReactNode {
  const shorts = useAnim((s) => s.exportSize === 'shorts')
  if (!shorts) return null
  return (
    <div className="shorts-guide" aria-hidden>
      <div className="shorts-frame">
        <div className="shorts-buttons" />
        <div className="shorts-caption" />
      </div>
    </div>
  )
}

/**
 * Animation mode: the selected block's path is drawn over the scene with a handle on each point. Dragging a handle
 * moves it along the ground; with "Add points" on, clicking the ground adds one. The selected character's whole
 * motion is drawn as a blue trail.
 */
function AnimationPaths(): ReactNode {
  const mode = useAnim((s) => s.mode)
  const selectedClip = useAnim((s) => s.selectedClip)
  const selectedPoint = useAnim((s) => s.selectedPoint)
  const addingPoints = useAnim((s) => s.addingPoints)
  const starts = useAnim((s) => s.starts)
  const selectedId = useStore((s) => s.selectedId)
  const animation = useStore((s) => s.settings.animation)
  const { gl, camera } = useThree()
  const clip = animation && mode === 'animation' ? clipOf(selectedClip) : undefined
  const start = clip ? starts[clip.id] : undefined
  const path = clip?.path
  const clipId = clip?.id
  const target = clip?.type === 'reach' ? clip.target : undefined
  const picking = useAnim((s) => s.pickingTarget)
  const going = useAnim((s) => s.goingTo)

  useEffect(() => {
    if (!clipId && !going) return
    const el = gl.domElement.closest('.viewport') as HTMLElement | null
    if (!el) return
    const rayAt = (e: MouseEvent): THREE.Raycaster => pointerRay(e, gl, camera)
    const current = (): { objectId: string; points: Vec3[] } | null => {
      const sel = useAnim.getState().selectedClip
      const c = clipOf(sel)
      return sel && c?.path ? { objectId: sel.objectId, points: c.path } : null
    }
    // Which path point is under the pointer (within a few pixels on screen), if any.
    const pick = (e: MouseEvent): number => {
      const cur = current()
      if (!cur) return -1
      const rect = gl.domElement.getBoundingClientRect()
      let best = -1
      let bestD = 16
      cur.points.forEach((p, i) => {
        const v = new THREE.Vector3(p[0], p[1] + 0.05, p[2]).project(camera)
        const d = Math.hypot(
          e.clientX - (rect.left + ((v.x + 1) / 2) * rect.width),
          e.clientY - (rect.top + ((1 - v.y) / 2) * rect.height)
        )
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best
    }
    let down: { x: number; y: number } | null = null
    let swallowClick = false
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return
      down = { x: e.clientX, y: e.clientY }
      const reach = clipOf(useAnim.getState().selectedClip)
      if (reach?.type === 'reach' && reach.target && !useAnim.getState().pickingTarget) {
        const rect = gl.domElement.getBoundingClientRect()
        const v = new THREE.Vector3(...reach.target).project(camera)
        const d = Math.hypot(
          e.clientX - (rect.left + ((v.x + 1) / 2) * rect.width),
          e.clientY - (rect.top + ((1 - v.y) / 2) * rect.height)
        )
        const sel = useAnim.getState().selectedClip
        if (d < 18 && sel) {
          // Grab the target: it slides over the plane it floats in.
          e.stopPropagation()
          e.preventDefault()
          swallowClick = true
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -reach.target[1])
          let began = false
          const move = (ev: PointerEvent): void => {
            const hit = rayAt(ev).ray.intersectPlane(plane, new THREE.Vector3())
            if (!hit) return
            if (!began) {
              if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
              beginEdit()
              began = true
            }
            setClipReach(sel.objectId, reach.id, { target: [hit.x, reach.target![1], hit.z] }, true)
          }
          const up = (): void => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            if (began) finishEdit(sel.objectId)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
          return
        }
      }
      const i = pick(e)
      const cur = current()
      if (i < 0 || !cur) return
      // Grab the handle: the camera and the scene's own clicks never see this press.
      e.stopPropagation()
      e.preventDefault()
      swallowClick = true
      useAnim.setState({ selectedPoint: i })
      const y = cur.points[i][1]
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
      let last: Vec3 | null = null
      let began = false
      const move = (ev: PointerEvent): void => {
        const hit = rayAt(ev).ray.intersectPlane(plane, new THREE.Vector3())
        if (!hit) return
        if (!began) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
          beginEdit()
          began = true
        }
        last = [hit.x, y, hit.z]
        setPathPoint(cur.objectId, clipId!, i, last, true)
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (began && last) {
          setPathPoint(cur.objectId, clipId!, i, dropPoint(last), true)
          finishEdit(cur.objectId)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    const onClick = (e: MouseEvent): void => {
      if (e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return
      if (swallowClick) {
        swallowClick = false
        e.stopPropagation()
        return
      }
      const picking = useAnim.getState().pickingTarget
      const sending = useAnim.getState().goingTo
      if (!useAnim.getState().addingPoints && !picking && !sending) return
      // Not a selection click: the scene's own click handling never sees it.
      e.stopPropagation()
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const owner = useAnim.getState().selectedClip?.objectId ?? useStore.getState().selectedId
      // Nothing there: the level the character stands on.
      const point = groundAt(e, gl, camera, owner, current()?.points.at(-1)?.[1] ?? 0)
      if (point && sending) {
        const who = useStore.getState().selectedId
        useAnim.setState({ goingTo: false })
        if (who) goTo(who, point)
      } else if (point && picking) {
        const sel = useAnim.getState().selectedClip
        if (sel) setClipReach(sel.objectId, sel.clipId, { target: point })
        useAnim.setState({ pickingTarget: false })
      } else if (point) addClipPoint(point)
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('click', onClick, true)
    }
  }, [clipId, going, gl, camera])

  useEffect(() => {
    const el = gl.domElement.closest('.viewport') as HTMLElement | null
    if (!el || !(addingPoints || picking || going)) return
    const prev = el.style.cursor
    el.style.cursor = 'crosshair'
    return () => void (el.style.cursor = prev)
  }, [addingPoints, picking, going, gl])

  // Where a Reach block's hand is going.
  const mark = useMemo(() => {
    if (!target) return null
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 10),
      new THREE.MeshBasicMaterial({ color: '#ff7a3a', depthTest: false, transparent: true, opacity: 0.95 })
    )
    m.position.set(...target)
    m.renderOrder = 999
    m.userData.helper = true
    m.raycast = () => {}
    return m
  }, [target])

  const handles = useMemo(() => {
    if (!start || !path?.length) return null
    const group = new THREE.Group()
    group.userData.helper = true
    const all = [start, ...path]
    const pts = new PathCurve(all).samples
    group.add(
      helperLine(
        pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.05, 0))),
        PATH_COLOR
      )
    )
    const dot = new THREE.SphereGeometry(0.16, 16, 10)
    all.forEach((p, i) => {
      const picked = i - 1 === selectedPoint
      const m = new THREE.Mesh(
        dot,
        new THREE.MeshBasicMaterial({
          color: i === 0 ? '#ffffff' : picked ? '#ff7a3a' : PATH_COLOR,
          depthTest: false,
          transparent: true,
          opacity: i === 0 ? 0.6 : 1
        })
      )
      m.position.set(p[0], p[1] + 0.05, p[2])
      m.scale.setScalar(i === 0 ? 0.7 : picked ? 1.35 : 1)
      m.renderOrder = 999
      m.userData.helper = true
      m.raycast = () => {}
      group.add(m)
    })
    return group
  }, [start, path, selectedPoint])

  // The motion: where each character is at each moment of the animation, with a dot on every second.
  const trails = useAnim((s) => s.trails)
  const trail = useMemo(() => {
    if (mode !== 'animation' || trails === 'off') return null
    const group = new THREE.Group()
    group.userData.helper = true
    for (const track of animation?.tracks ?? []) {
      if (track.keys.length < 2 || (trails === 'selected' && track.objectId !== selectedId)) continue
      const end = track.keys[track.keys.length - 1].t
      const pts: THREE.Vector3[] = []
      const dots: THREE.Vector3[] = []
      for (let t = track.keys[0].t; t <= end + 1e-6; t += 1 / 20) {
        const st = sampleTrack(track, t)
        if (!st) continue
        const p = new THREE.Vector3(st.position[0], st.position[1] + 0.05, st.position[2])
        pts.push(p)
        if (Math.abs(t - Math.round(t)) < 1 / 40) dots.push(p.clone())
      }
      const selected = track.objectId === selectedId
      group.add(helperLine(pts, selected ? '#7fb8ff' : '#9aa6b8', selected ? 0.8 : 0.45))
      const points = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(dots),
        new THREE.PointsMaterial({
          color: selected ? '#ffffff' : '#c8d0dc',
          size: 5,
          sizeAttenuation: false,
          depthTest: false,
          transparent: true,
          opacity: 0.85
        })
      )
      points.renderOrder = 999
      points.userData.helper = true
      points.raycast = () => {}
      group.add(points)
    }
    return group.children.length ? group : null
  }, [mode, animation, selectedId, trails])

  useEffect(
    () => () => {
      for (const o of [handles, trail, mark])
        o?.traverse((x) => {
          ;(x as THREE.Mesh).geometry?.dispose()
          const m = (x as THREE.Mesh).material as THREE.Material | undefined
          m?.dispose()
        })
    },
    [handles, trail, mark]
  )

  if (mode !== 'animation') return null
  return (
    <>
      {trail && <primitive object={trail} />}
      {handles && <primitive object={handles} />}
      {mark && <primitive object={mark} />}
    </>
  )
}

/**
 * Onion skin: with the animation paused, the selected character is drawn faintly where it was (red) and will be
 * (green) a quarter and a half second away from the playhead, so the motion reads at a glance.
 */
function OnionSkin(): ReactNode {
  const mode = useAnim((s) => s.mode)
  const on = useAnim((s) => s.onion)
  const time = useAnim((s) => s.time)
  const playing = useAnim((s) => s.playing)
  const selectedId = useStore((s) => s.selectedId)
  const animation = useStore((s) => s.settings.animation)
  const objects = useStore((s) => s.objects)
  const ghosts = useMemo(() => {
    if (mode !== 'animation' || !on || playing || !selectedId) return null
    const track = animation?.tracks.find((t) => t.objectId === selectedId)
    const o = objects.find((x) => x.id === selectedId)
    const src = viewport.objects.get(selectedId)
    if (!track || !o || !src || track.keys.length < 2) return null
    const len = animationLength(animation)
    const group = new THREE.Group()
    group.userData.helper = true
    for (const [dt, color, opacity] of [
      [-0.5, '#ff6b6b', 0.18],
      [-0.25, '#ff6b6b', 0.3],
      [0.25, '#6bff9a', 0.3],
      [0.5, '#6bff9a', 0.18]
    ] as const) {
      const t = time + dt
      if (t < 0 || t > len) continue
      const st = stateAt(track, t, o)
      if (!st) continue
      const g = SkeletonUtils.clone(src)
      const drop: THREE.Object3D[] = []
      g.traverse((x) => {
        x.userData.helper = true
        x.raycast = () => {}
        const mesh = x as THREE.Mesh
        if (mesh.isMesh)
          mesh.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
        else if ((x as THREE.Sprite).isSprite || (x as THREE.Line).isLine) drop.push(x)
      })
      drop.forEach((x) => x.removeFromParent())
      g.position.set(...st.position)
      g.rotation.set(deg(st.rotation[0]), deg(st.rotation[1]), deg(st.rotation[2]))
      if (o.kind === 'player' && st.pose) applyPose(g, st.pose)
      else if (st.parts) {
        const mob = g.getObjectByName('mob')
        if (mob) applyMobPose(mob, st.parts)
      }
      group.add(g)
    }
    return group
  }, [mode, on, playing, time, selectedId, animation, objects])
  useEffect(
    () => () => {
      ghosts?.traverse((x) => ((x as THREE.Mesh).material as THREE.Material | undefined)?.dispose())
    },
    [ghosts]
  )
  return ghosts ? <primitive object={ghosts} /> : null
}

/** Shift+drag on empty space draws a box; everything whose centre is inside it gets selected (Ctrl adds). */
function BoxSelect(): null {
  const { gl, camera } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const rect = document.createElement('div')
    rect.className = 'box-select'
    let start: { x: number; y: number } | null = null
    const orbit = (): { enabled: boolean } | null => viewport.controls as unknown as { enabled: boolean } | null
    const place = (e: PointerEvent): void => {
      if (!start) return
      const host = el.parentElement!.getBoundingClientRect()
      Object.assign(rect.style, {
        left: `${Math.min(start.x, e.clientX) - host.left}px`,
        top: `${Math.min(start.y, e.clientY) - host.top}px`,
        width: `${Math.abs(e.clientX - start.x)}px`,
        height: `${Math.abs(e.clientY - start.y)}px`
      })
    }
    const down = (e: PointerEvent): void => {
      if (!e.shiftKey || e.button !== 0 || viewport.gizmo?.axis) return
      start = { x: e.clientX, y: e.clientY }
      const o = orbit()
      if (o) o.enabled = false
      place(e)
      el.parentElement!.appendChild(rect)
      window.addEventListener('pointermove', place)
      window.addEventListener('pointerup', up, { once: true })
    }
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', place)
      rect.remove()
      const o = orbit()
      if (o) o.enabled = true
      if (!start) return
      const [x0, x1] = [Math.min(start.x, e.clientX), Math.max(start.x, e.clientX)]
      const [y0, y1] = [Math.min(start.y, e.clientY), Math.max(start.y, e.clientY)]
      start = null
      if (x1 - x0 < 4 && y1 - y0 < 4) return // just a Shift+click, handled by the object itself
      const r = el.getBoundingClientRect()
      const box = new THREE.Box3()
      const v = new THREE.Vector3()
      const hits: string[] = []
      for (const ob of useStore.getState().objects) {
        if (!ob.visible || (ob.kind === 'terrain' && ob.ground)) continue
        const obj = viewport.objects.get(ob.id)
        if (!obj) continue
        box.setFromObject(obj)
        if (box.isEmpty()) continue
        box.getCenter(v).project(camera)
        if (v.z > 1) continue
        const sx = r.left + ((v.x + 1) / 2) * r.width
        const sy = r.top + ((1 - v.y) / 2) * r.height
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hits.push(ob.id)
      }
      const s = useStore.getState()
      s.setSelection(e.ctrlKey || e.metaKey ? [...selection(s), ...hits] : hits)
    }
    // Capture phase, so the camera controls see themselves switched off before they start orbiting.
    el.addEventListener('pointerdown', down, true)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', place)
      rect.remove()
    }
  }, [gl, camera])
  return null
}

function Gizmo(): ReactNode {
  const selected = useStore(useShallow((s) => selection(s)))
  const selectedId = useStore((s) => s.selectedId)
  const selectedJoint = useStore((s) => s.selectedJoint)
  const ikMode = useStore((s) => s.ikMode)
  const objects = useStore((s) => s.objects)
  const [target, setTarget] = useState<THREE.Object3D | null>(null)
  useEffect(() => setTarget(selectedId ? (viewport.objects.get(selectedId) ?? null) : null), [selectedId, objects])
  const player = objects.find((o): o is PlayerObject => o.id === selectedId && o.kind === 'player')
  // Stickers sit on the frame, not in the world: they're dragged in the sticker layer, not with these handles.
  const world = selected.filter((id) => objects.find((o) => o.id === id)?.kind !== 'sticker')
  if (world.length > 1) return <GroupGizmo ids={world} />
  if (player && selectedJoint) {
    const limb = ikMode ? limbOf(selectedJoint) : null
    if (limb) return <IkGizmo id={player.id} limb={limb} slim={player.slim} />
    return <JointGizmo id={player.id} joint={selectedJoint} />
  }
  if (!target || !selectedId) return null
  return <ObjectGizmo key={selectedId} id={selectedId} target={target} />
}

/**
 * The box around what an object actually draws (in world space; empty when it draws nothing). Builds and
 * terrain are anchored at a corner of their whole area, air included, so their handles and framing use this.
 * Helpers, hidden parts and pieces marked `noCentre` (a beacon's beam) are left out.
 */
export function drawnBox(obj: THREE.Object3D, box = new THREE.Box3()): THREE.Box3 {
  box.makeEmpty()
  const part = new THREE.Box3()
  const visit = (o: THREE.Object3D): void => {
    if (!o.visible || isHelperObject(o) || o.userData.noCentre) return
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (g) {
      if (o instanceof THREE.InstancedMesh) {
        if (!o.boundingBox) o.computeBoundingBox()
        if (o.boundingBox) part.copy(o.boundingBox)
      } else {
        if (!g.boundingBox) g.computeBoundingBox()
        if (g.boundingBox) part.copy(g.boundingBox)
      }
      if (!part.isEmpty()) box.union(part.applyMatrix4(o.matrixWorld))
    }
    for (const c of o.children) visit(c)
  }
  obj.updateWorldMatrix(true, true)
  visit(obj)
  return box
}

/** The centre of what an object draws, or null when it draws nothing. */
function drawnCentre(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 | null {
  const box = drawnBox(obj)
  return box.isEmpty() ? null : box.getCenter(out)
}

/**
 * Move, turn and resize handles for one object. They sit at the middle of what the object draws (not at its
 * origin, which for a build can be far off in the air), and dragging them moves, turns or resizes the object
 * around that point.
 */
function ObjectGizmo({ id, target }: { id: string; target: THREE.Object3D }): ReactNode {
  const mode = useStore((s) => s.transformMode)
  const update = useStore((s) => s.update)
  const blocky = useStore((s) => movesByBlocks(s.objects.find((o) => o.id === id)?.kind))
  const { scene } = useThree()
  const controls = useRef<ComponentRef<typeof TransformControls>>(null)
  useGizmoRegistry(controls)
  const pivot = useMemo(() => {
    const p = new THREE.Object3D()
    p.userData.helper = true
    return p
  }, [])
  const start = useRef<{
    origin: THREE.Vector3
    pivotInverse: THREE.Matrix4
    world: THREE.Matrix4
    offset: THREE.Vector3
    scale: number
  } | null>(null)
  useEffect(() => {
    scene.add(pivot)
    return () => void scene.remove(pivot)
  }, [scene, pivot])
  const at = useMemo(() => new THREE.Vector3(), [])
  // Follow the object (undo, the properties panel, a model still loading) while it isn't being dragged.
  const watch = useMemo(() => new MeasureWatch(), [])
  useFrame(() => {
    if (start.current) return
    if (!watch.changed([target]) && pivot.scale.x === 1) return
    const c = drawnCentre(target, at) ?? target.getWorldPosition(at)
    if (!pivot.position.equals(c) || pivot.scale.x !== 1) {
      pivot.position.copy(c)
      pivot.rotation.set(0, 0, 0)
      pivot.scale.setScalar(1)
      pivot.updateMatrixWorld()
    }
  })
  const m = useMemo(() => new THREE.Matrix4(), [])
  const sc = useMemo(() => new THREE.Vector3(), [])
  const commit = (): void => {
    start.current = null
    const r = target.rotation
    update(id, {
      position: [target.position.x, target.position.y, target.position.z],
      rotation: [r.x, r.y, r.z].map((v) => Math.round(THREE.MathUtils.radToDeg(v) * 10) / 10) as [
        number,
        number,
        number
      ],
      scale: target.scale.x
    })
  }
  return (
    <TransformControls
      ref={controls}
      object={pivot}
      mode={mode}
      showY
      onMouseDown={() => {
        pivot.updateMatrixWorld()
        target.updateWorldMatrix(true, false)
        start.current = {
          origin: pivot.position.clone(),
          pivotInverse: pivot.matrixWorld.clone().invert(),
          world: target.matrixWorld.clone(),
          offset: pivot.position.clone().sub(target.getWorldPosition(new THREE.Vector3())),
          scale: target.scale.x
        }
      }}
      onMouseUp={commit}
      onObjectChange={() => {
        const st = start.current
        if (!st) return
        if (mode === 'translate' && (pointer.shift || useStore.getState().settings.snap)) {
          // Hold Shift (or turn on Snap) to snap the object's own anchor, as before: onto the surface or vertex
          // under the cursor, else the half-block grid. Dragging an arrow or plane only snaps along it.
          const axis = (controls.current as unknown as { axis: string | null } | null)?.axis ?? 'XYZ'
          const hit = snapPoint(pointer.ndc, viewport.camera, id)
          const anchor = pivot.position.clone().sub(st.offset)
          if (axis === 'XYZ' || axis === 'E') {
            if (hit) anchor.copy(hit)
          } else
            for (const a of ['x', 'y', 'z'] as const)
              if (axis.includes(a.toUpperCase())) anchor[a] = hit ? hit[a] : Math.round(anchor[a] * 2) / 2
          pivot.position.copy(anchor).add(st.offset)
        } else if (mode === 'translate' && blocky) {
          for (const a of ['x', 'y', 'z'] as const)
            pivot.position[a] = st.origin[a] + Math.round(pivot.position[a] - st.origin[a])
        }
        if (mode === 'scale') {
          // Keep scale uniform: follow whichever axis handle is being dragged.
          const s = pivot.scale
          s.setScalar([s.x, s.y, s.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a)))
        }
        pivot.updateMatrixWorld()
        // The handles' change, applied to the object as it was when the drag began.
        const world = m.multiplyMatrices(pivot.matrixWorld, st.pivotInverse).multiply(st.world)
        if (target.parent) world.premultiply(target.parent.matrixWorld.clone().invert())
        world.decompose(target.position, target.quaternion, sc)
        target.scale.setScalar(sc.x)
      }}
    />
  )
}

class GlErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error): { error: string } {
    return { error: e.message }
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="gl-error">
        <strong>The 3D viewport stopped working.</strong>
        <span>{this.state.error}</span>
        <span>Your scene is safe. If this keeps happening, updating your graphics driver usually fixes it.</span>
        <button
          className="primary"
          onClick={() => {
            this.setState({ error: null })
            this.props.onRetry()
          }}
        >
          Restart the viewport
        </button>
      </div>
    )
  }
}

/**
 * A driver reset or a weak GPU running out of memory can take the WebGL context away. Rebuild the viewport
 * when it comes back instead of leaving a black square (the scene itself lives in the store).
 */
function watchContext(canvas: HTMLCanvasElement, rebuild: () => void): void {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    useStore.getState().setStatus('The graphics driver reset; restoring the viewport…')
  })
  canvas.addEventListener('webglcontextrestored', () => {
    useStore.getState().setStatus('Viewport restored')
    rebuild()
  })
}

/**
 * The biggest box of the export's shape that fits inside the frame's padding, kept up to date as the window or the
 * panels change size. CSS alone (aspect-ratio with a max-height) stretches the picture once the height runs out.
 */
function useFitBox(frame: React.RefObject<HTMLDivElement | null>, ratio: number): [number, number] | null {
  const [box, setBox] = useState<[number, number] | null>(null)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const fit = (): void => {
      const cs = getComputedStyle(el)
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      if (w <= 0 || h <= 0) return
      const next: [number, number] =
        w / h > ratio ? [Math.floor(h * ratio), Math.floor(h)] : [Math.floor(w), Math.floor(w / ratio)]
      setBox((b) => (b && b[0] === next[0] && b[1] === next[1] ? b : next))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frame, ratio])
  return box
}

/** The canvas shapes most thumbnails and clips are made in, one click each, above the canvas. */
const CANVAS_SHAPES: { label: string; hint: string; size: [number, number] }[] = [
  { label: 'YouTube', hint: '16:9, 1280 × 720 (pick Full HD or 4K under Export)', size: [1280, 720] },
  { label: 'Shorts', hint: '9:16, 1080 × 1920', size: [1080, 1920] },
  { label: 'Square', hint: '1:1, 1080 × 1080', size: [1080, 1080] },
  { label: 'Portrait', hint: '4:5, 1080 × 1350, for Instagram posts', size: [1080, 1350] }
]

function CanvasSize(): ReactNode {
  const [w, h] = useStore(useShallow((s) => [s.settings.exportWidth, s.settings.exportHeight]))
  const setSettings = useStore((s) => s.setSettings)
  const same = (a: [number, number]): boolean => Math.abs(a[0] / a[1] - w / h) < 0.01
  return (
    <div className="canvas-size segmented" role="radiogroup" aria-label="Canvas shape">
      {CANVAS_SHAPES.map((c) => (
        <button
          key={c.label}
          role="radio"
          aria-checked={same(c.size)}
          className={same(c.size) ? 'active' : ''}
          title={c.hint}
          // Same shape already (a 4K YouTube thumbnail): keep its size.
          onClick={() => !same(c.size) && setSettings({ exportWidth: c.size[0], exportHeight: c.size[1] })}
        >
          {c.label}
        </button>
      ))}
      {!CANVAS_SHAPES.some((c) => same(c.size)) && (
        <span className="canvas-size-custom">
          {w} × {h}
        </span>
      )}
    </div>
  )
}

export function Viewport(): ReactNode {
  const objects = useStore((s) => s.objects)
  const select = useStore((s) => s.select)
  const showGrid = useStore((s) => s.settings.showGrid)
  const exportWidth = useStore((s) => s.settings.exportWidth)
  const exportHeight = useStore((s) => s.settings.exportHeight)
  const animating = useAnim((s) => s.mode === 'animation')
  // Bumped to rebuild the whole canvas after the GPU context is lost or the viewport crashed.
  const [glKey, setGlKey] = useState(0)
  const rebuild = (): void => {
    // Keep the user's view across the rebuild.
    const view = cameraBridge.get?.()
    setGlKey((k) => k + 1)
    if (view) setTimeout(() => cameraBridge.set?.(view), 100)
  }
  const frame = useRef<HTMLDivElement>(null)
  const box = useFitBox(frame, exportWidth / exportHeight)
  return (
    <div className={`viewport-frame ${animating ? 'animating' : ''}`} ref={frame}>
      <CanvasSize />
      <div className="viewport" style={box ? { width: box[0], height: box[1] } : { visibility: 'hidden' }}>
        <GlErrorBoundary onRetry={rebuild}>
          <Canvas
            key={glKey}
            flat
            shadows={{ type: THREE.PCFShadowMap }}
            // Exports always render at full resolution; the live view caps pixel density to stay smooth.
            dpr={[1, 1.5]}
            gl={{ antialias: true }}
            onCreated={({ gl }) => {
              gl.localClippingEnabled = true
              watchContext(gl.domElement, rebuild)
            }}
            camera={{ position: [7, 4, 9], fov: 70, near: 0.1, far: 2000 }}
            onPointerMissed={(e) => !wasDrag(e) && !e.shiftKey && !e.ctrlKey && !e.metaKey && select(null)}
          >
            <Bridge />
            <IdleFrameloop />
            <ShadowThrottle />
            <PointerTracker />
            <SelectionTracker />
            <FovSync />
            <Environment />
            <SkyBackdrop />
            <Weather />
            {objects.map((o, i) =>
              // Stickers are 2D layers on the frame, drawn by the sticker layer instead.
              o.kind === 'sticker' ? null : <ObjectNode key={o.id} o={o} order={i} />
            )}
            {showGrid && <gridHelper args={[64, 64, '#666', '#333']} userData={{ helper: true }} />}
            <AnimationDriver />
            <AnimationPaths />
            <DrawAndRing />
            <OnionSkin />
            <Gizmo />
            <SelectionBoxes />
            <BoxSelect />
            <Effects />
            <OrbitControls
              makeDefault
              enableDamping={false}
              target={[0, 1.5, 0]}
              onStart={() => {
                // Remember the view before each orbit/pan/zoom so Ctrl+Z can bring it back.
                cameraMove = { before: cameraBridge.get?.() ?? null, at: Date.now() }
              }}
              onEnd={() => {
                const moved = cameraMove
                cameraMove = null
                // Moving the view with a camera block selected sets where that block starts (and is undone with it).
                if (!moved || adoptViewportView()) return
                if (moved.before) useStore.getState().recordCamera(moved.before, moved.at)
              }}
            />
          </Canvas>
          <FocusPoints />
          <StickerLayer />
          {animating && <ActionRing />}
          {animating && <ShortsGuide />}
          <Rulers />
          <ViewportOverlay />
        </GlErrorBoundary>
      </div>
      {animating && (
        <AppErrorBoundary area="timeline">
          <Timeline />
        </AppErrorBoundary>
      )}
    </div>
  )
}

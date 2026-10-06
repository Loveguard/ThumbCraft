import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, TransformControls } from '@react-three/drei'
import { Component, memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import * as THREE from 'three'
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
import { SkyBackdrop } from './SkyBackdrop'
import { snapPoint } from './snapping'
import { ViewportOverlay } from './ViewportOverlay'
import { applyMobPose, buildMob, mobModels } from '../minecraft/mobs'
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
import { isLit, LIGHTING, type RenderMode } from '../renderModes'
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

/**
 * Runs an async builder when its inputs change. `dispose` frees a result once it has been replaced on screen
 * (or the node unmounts), and frees results that arrive after they were no longer wanted.
 */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[], dispose?: (v: NonNullable<T>) => void): T | null {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    fn().then(
      (r) => {
        if (alive) setV(() => r)
        else if (r) dispose?.(r as NonNullable<T>)
      },
      (e) => console.error(e)
    )
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
  return group ? <primitive object={group} /> : null
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
  const mob = useAsync(
    async () => {
      const layer = (await mobModels()).layers[o.layer]
      return layer ? buildMob(layer, o.texture) : null
    },
    [o.layer, o.texture],
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

function ImageNode({ o, order }: { o: ImageObject; order: number }): ReactNode {
  const texture = useAsync(async () => {
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
  }, [o.url, o.kind, o.pixelated])
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
  const g = useAsync(
    () => buildPixelText(o.text, o.color, o.depth, o.shadow, o.style),
    [o.text, o.color, o.depth, o.shadow, o.style],
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
  const custom = useAsync(async () => {
    const m = o.gobo === 'custom' && o.goboMediaId ? mediaStore.get(o.goboMediaId) : null
    if (!m) return null
    const t = await new THREE.TextureLoader().loadAsync(m.url)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [o.gobo, o.goboMediaId])
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
    if (o.kind === 'player' && selectedId === o.id) selectJoint(jointOf(e.object))
    else select(o.id)
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
  const lit = isLit(renderMode) ? LIGHTING[renderMode as Exclude<RenderMode, 'vanilla'>] : null
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
    viewport.capture = (w, h) => {
      const cam = camera as THREE.PerspectiveCamera
      const helpers: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (isHelperObject(o) && o.visible) {
          helpers.push(o)
          o.visible = false
        }
      })
      const prevRatio = gl.getPixelRatio()
      const composer = composerHandle.current
      // Render once at the export size, through the post-processing chain when effects are on.
      const renderAt = (width: number, height: number, ratio: number): void => {
        gl.setPixelRatio(ratio)
        if (composer) composer.setSize(width, height, false)
        else gl.setSize(width, height, false)
        cam.aspect = width / height
        cam.updateProjectionMatrix()
        renderFrame(gl, scene, cam, composer)
      }
      renderAt(w, h, 1)
      const url = gl.domElement.toDataURL('image/png')
      helpers.forEach((o) => (o.visible = true))
      renderAt(size.width, size.height, prevRatio)
      return url
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

/** Keeps the floating selection toolbar just above the selected object on screen (and the rulers' selection marks). */
function SelectionTracker(): null {
  const ids = useStore(useShallow((s) => selection(s)))
  const box = useMemo(() => new THREE.Box3(), [])
  const one = useMemo(() => new THREE.Box3(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const el = viewport.selectionToolbar
    // Above everything selected, so it never sits on the group's handles.
    box.makeEmpty()
    for (const id of ids) {
      const obj = viewport.objects.get(id)
      if (obj?.visible) box.union(one.setFromObject(obj))
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
  const mode = useStore((s) => s.transformMode)
  const update = useStore((s) => s.update)
  const objects = useStore((s) => s.objects)
  const [target, setTarget] = useState<THREE.Object3D | null>(null)
  const controls = useRef<ComponentRef<typeof TransformControls>>(null)
  useGizmoRegistry(controls)
  useEffect(() => setTarget(selectedId ? (viewport.objects.get(selectedId) ?? null) : null), [selectedId, objects])
  const player = objects.find((o): o is PlayerObject => o.id === selectedId && o.kind === 'player')
  if (selected.length > 1) return <GroupGizmo ids={selected} />
  if (player && selectedJoint) {
    const limb = ikMode ? limbOf(selectedJoint) : null
    if (limb) return <IkGizmo id={player.id} limb={limb} slim={player.slim} />
    return <JointGizmo id={player.id} joint={selectedJoint} />
  }
  if (!target || !selectedId) return null
  const commit = (): void => {
    const r = target.rotation
    update(selectedId, {
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
      object={target}
      mode={mode}
      showY
      onMouseUp={commit}
      onObjectChange={() => {
        if (mode === 'translate') {
          // Hold Shift (or turn on Snap) to snap. Dragging an arrow or plane only moves along it: the snapped
          // spot (a surface or vertex under the cursor, else the half-block grid) is used on those axes only.
          if (pointer.shift || useStore.getState().settings.snap) {
            const axis = (controls.current as unknown as { axis: string | null } | null)?.axis ?? 'XYZ'
            const hit = snapPoint(pointer.ndc, viewport.camera, selectedId)
            const local = hit && (target.parent ? target.parent.worldToLocal(hit) : hit)
            if (axis === 'XYZ' || axis === 'E') {
              if (local) target.position.copy(local)
            } else
              for (const a of ['x', 'y', 'z'] as const)
                if (axis.includes(a.toUpperCase()))
                  target.position[a] = local ? local[a] : Math.round(target.position[a] * 2) / 2
          }
          return
        }
        if (mode !== 'scale') return
        // Keep scale uniform: follow whichever axis handle is being dragged.
        const prev = objects.find((o) => o.id === selectedId)?.scale ?? 1
        const s = target.scale
        const v = [s.x, s.y, s.z].reduce((a, b) => (Math.abs(b - prev) > Math.abs(a - prev) ? b : a))
        s.setScalar(v)
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

export function Viewport(): ReactNode {
  const objects = useStore((s) => s.objects)
  const select = useStore((s) => s.select)
  const showGrid = useStore((s) => s.settings.showGrid)
  const exportWidth = useStore((s) => s.settings.exportWidth)
  const exportHeight = useStore((s) => s.settings.exportHeight)
  // Bumped to rebuild the whole canvas after the GPU context is lost or the viewport crashed.
  const [glKey, setGlKey] = useState(0)
  const rebuild = (): void => {
    // Keep the user's view across the rebuild.
    const view = cameraBridge.get?.()
    setGlKey((k) => k + 1)
    if (view) setTimeout(() => cameraBridge.set?.(view), 100)
  }
  return (
    <div className="viewport-frame">
      <div className="viewport" style={{ aspectRatio: `${exportWidth} / ${exportHeight}` }}>
        <GlErrorBoundary onRetry={rebuild}>
          <Canvas
            key={glKey}
            flat
            shadows={{ type: THREE.PCFShadowMap }}
            // Exports always render at full resolution; the live view caps pixel density to stay smooth.
            dpr={[1, 1.5]}
            gl={{ antialias: true }}
            onCreated={({ gl }) => watchContext(gl.domElement, rebuild)}
            camera={{ position: [7, 4, 9], fov: 70, near: 0.1, far: 2000 }}
            onPointerMissed={(e) => !wasDrag(e) && !e.shiftKey && !e.ctrlKey && !e.metaKey && select(null)}
          >
            <Bridge />
            <ShadowThrottle />
            <PointerTracker />
            <SelectionTracker />
            <FovSync />
            <Environment />
            <SkyBackdrop />
            <Weather />
            {objects.map((o, i) => (
              <ObjectNode key={o.id} o={o} order={i} />
            ))}
            {showGrid && <gridHelper args={[64, 64, '#666', '#333']} userData={{ helper: true }} />}
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
                if (cameraMove?.before) useStore.getState().recordCamera(cameraMove.before, cameraMove.at)
                cameraMove = null
              }}
            />
          </Canvas>
          <FocusPoints />
          <Rulers />
          <ViewportOverlay />
        </GlErrorBoundary>
      </div>
    </div>
  )
}

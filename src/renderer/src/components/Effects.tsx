import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, ChromaticAberration, EffectComposer, GodRays, Noise, SMAA, Vignette } from '@react-three/postprocessing'
import { BlendFunction, Effect, LUT3DEffect, Pass, type EffectComposer as Composer } from 'postprocessing'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import * as THREE from 'three'
import { useStore, type EffectSettings, type SceneSettings } from '../store'
import { ColorGradeEffect } from './colorGrade'
import { withShaderLook } from '../renderModes'
import { Cartoon } from './cartoon'
import { FocusBlurEffect } from './focusBlur'
import { CrtEffect } from './retro'
import { AnamorphicEffect, LensWarpEffect, SpeedBurstEffect } from './lens'
import { HELPER_LAYER, liftHandles, OVERLAY_LAYER } from '../overlay'
import { lookLut, parseCube } from '../grading'
import { mediaStore } from '../media'

/** Unit vector pointing at the sun for the given azimuth/elevation (degrees). */
export function sunDirection(azimuth: number, elevation: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuth)
  const el = THREE.MathUtils.degToRad(elevation)
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
}

/** Sun angles that put it in the upper part of the current view, where god rays read best. */
export function sunInView(camera: THREE.Camera | null): Pick<SceneSettings, 'sunAzimuth' | 'sunElevation'> | null {
  if (!camera) return null
  const dir = new THREE.Vector3()
  camera.getWorldDirection(dir)
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 70
  const azimuth = Math.round(THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z)))
  const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)))
  const elevation = Math.round(THREE.MathUtils.clamp(pitch + fov * 0.25, 4, 75))
  return { sunAzimuth: azimuth, sunElevation: elevation }
}

/** Handle to the active composer, so export can render the image with effects at full size. */
export const composerHandle: { current: Composer | null } = { current: null }

const hasGrade = (e: EffectSettings): boolean =>
  e.exposure !== 0 || e.contrast !== 0 || e.saturation !== 0 || e.temperature !== 0 || e.tint !== 0 || e.split !== 0

export const hasEffects = (e: EffectSettings): boolean =>
  hasGrade(e) ||
  !!e.look ||
  e.vignette ||
  e.grain ||
  e.bloom ||
  e.godRays ||
  e.chromatic ||
  e.depthOfField ||
  e.crt ||
  e.warp ||
  e.burst ||
  e.streaks

/** What the effect chain covers this frame (set while rendering the Effects component). */
const chain = { active: false, includesOverlays: false }

/** Draws only the overlay layer over what's already in `target` (null = the screen), every light still lighting it. */
function drawOverlayLayer(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null
): void {
  const background = scene.background
  const mask = camera.layers.mask
  scene.background = null
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight) o.layers.enable(OVERLAY_LAYER)
  })
  camera.layers.set(OVERLAY_LAYER)
  const autoClear = gl.autoClear
  gl.autoClear = false
  gl.setRenderTarget(target)
  gl.clearDepth()
  gl.render(scene, camera)
  gl.autoClear = autoClear
  camera.layers.mask = mask
  scene.background = background
}

/** The editing handles over the finished frame, sharp whatever effects are on. */
function drawHelperLayer(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  liftHandles(scene)
  const background = scene.background
  const mask = camera.layers.mask
  scene.background = null
  camera.layers.set(HELPER_LAYER)
  const autoClear = gl.autoClear
  gl.autoClear = false
  gl.setRenderTarget(null)
  gl.render(scene, camera)
  gl.autoClear = autoClear
  camera.layers.mask = mask
  scene.background = background
}

/** The always-on-top layers drawn inside the effect chain, so effects after it (CRT) cover them too. */
class OverlayLayerPass extends Pass {
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super('OverlayLayerPass', scene, camera)
    this.needsSwap = false
  }
  render(gl: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    drawOverlayLayer(gl, this.scene, this.camera, inputBuffer)
  }
}

/**
 * One finished frame, for the live view and for export alike: the scene (through the effect chain when one is
 * active), then, when they're kept clean of effects, the always-on-top layers over the result (unless the
 * chain already drew them, ahead of a CRT that covers everything). `composer` is null when no effects are on.
 */
export function renderFrame(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  composer: Composer | null,
  composerAlreadyRan = false
): void {
  // Live, the chain has already rendered this frame (it runs just before); export renders it here.
  const useChain = chain.active && (composerAlreadyRan || !!composer)
  if (useChain) {
    if (!composerAlreadyRan) composer?.render()
  } else gl.render(scene, camera)
  if (useStore.getState().effects.cleanOverlays && !(useChain && chain.includesOverlays))
    drawOverlayLayer(gl, scene, camera, null)
  drawHelperLayer(gl, scene, camera)
}

/** Takes over drawing each frame (after the effect chain, which renders at priority 1). */
function FrameFinisher(): null {
  useFrame(({ gl, scene, camera }) => renderFrame(gl, scene, camera, composerHandle.current, true), 2)
  return null
}

/** The always-on-top layers as a step inside the effect chain. */
function OverlayPass(): ReactNode {
  const { scene, camera } = useThree()
  const pass = useMemo(() => new OverlayLayerPass(scene, camera), [scene, camera])
  return <primitive object={pass} dispose={null} />
}

/** A custom effect as a step in the chain, kept across renders and updated as its settings change. */
function CustomEffect<T extends Effect>({ make, apply }: { make: () => T; apply: (effect: T) => void }): ReactNode {
  const [effect] = useState(make)
  useEffect(() => apply(effect))
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} dispose={null} />
}

/** CRT as a step in the effect chain. */
function CrtPass({ amount, curve }: { amount: number; curve: number }): ReactNode {
  const effect = useMemo(() => new CrtEffect(), [])
  useEffect(() => effect.setLook(amount, curve), [effect, amount, curve])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} dispose={null} />
}

/** The custom .cube LUT, parsed once per imported file. */
const customLuts = new Map<string, THREE.Data3DTexture | null>()
function customLut(mediaId: string | null): THREE.Data3DTexture | null {
  if (!mediaId) return null
  if (!customLuts.has(mediaId)) {
    const m = mediaStore.get(mediaId)
    let lut: THREE.Data3DTexture | null = null
    try {
      lut = m ? parseCube(new TextDecoder().decode(m.bytes)) : null
    } catch {
      lut = null
    }
    customLuts.set(mediaId, lut)
  }
  return customLuts.get(mediaId) ?? null
}

/** Depth of field from the on-screen focus points. */
function FocusPass({
  points,
  range,
  blur
}: {
  points: { x: number; y: number }[]
  range: number
  blur: number
}): ReactNode {
  const effect = useMemo(() => new FocusBlurEffect(), [])
  useEffect(() => effect.setFocus(points, range, blur * 2.5), [effect, points, range, blur])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} dispose={null} />
}

/** The colour look as a 3D LUT pass, blended with the original by its intensity. */
function LookPass({
  look,
  intensity,
  lutMediaId
}: {
  look: string
  intensity: number
  lutMediaId: string | null
}): ReactNode {
  const lut = look === 'custom' ? customLut(lutMediaId) : lookLut(look)
  const effect = useMemo(
    () => (lut ? new LUT3DEffect(lut, { blendFunction: BlendFunction.NORMAL, tetrahedralInterpolation: true }) : null),
    [lut]
  )
  useEffect(() => {
    if (effect) effect.blendMode.opacity.value = intensity
  }, [effect, intensity])
  useEffect(() => () => effect?.dispose(), [effect])
  return effect ? <primitive object={effect} dispose={null} /> : null
}

// Which depth texture each pass was last given. When the composer is rebuilt (e.g. god rays toggle
// multisampling), reused effects can keep a stale depth texture and stop being occluded by the scene.
const syncedDepth = new WeakMap<Pass, unknown>()

/** A bright disc far away in the sun's direction: the light source god rays streak from. */
function Sun({ onMesh }: { onMesh: (m: THREE.Mesh | null) => void }): ReactNode {
  const { sunAzimuth, sunElevation } = useStore((s) => s.settings)
  const { sunColor, showSun } = useStore((s) => s.effects)
  const pos = useMemo(() => sunDirection(sunAzimuth, sunElevation).multiplyScalar(800), [sunAzimuth, sunElevation])
  return (
    <mesh ref={onMesh} position={pos} frustumCulled={false}>
      <sphereGeometry args={[34, 24, 12]} />
      {/* Transparent + no depth write is what the god-rays pass expects of its light source. */}
      <meshBasicMaterial
        color={sunColor}
        fog={false}
        toneMapped={false}
        transparent
        depthWrite={false}
        opacity={showSun ? 1 : 0.0001}
      />
    </mesh>
  )
}

export function Effects(): ReactNode {
  const userEffects = useStore((s) => s.effects)
  const renderMode = useStore((s) => s.settings.renderMode)
  // Shader looks (Soft, Cartoon) add their own bloom and colour under the user's Look.
  const e = useMemo(() => withShaderLook(userEffects, renderMode), [userEffects, renderMode])
  const [sun, setSun] = useState<THREE.Mesh | null>(null)
  const ref = useRef<Composer>(null)
  const cartoon = renderMode === 'cartoon'
  const active = hasEffects(e) || cartoon

  // Runs before the composer renders (priority 0 < 1): keep every pass on the composer's current depth.
  useFrame(() => {
    // Set here, not in an effect: the composer fills `ref` in its own later render, and an export taken in
    // between would otherwise skip every effect.
    composerHandle.current = active ? ref.current : null
    // The scene's depth lives on the composer's input buffer (the RenderPass target). The composer's own
    // `depthTexture` field (internal, untyped) can be left null after a rebuild, so prefer the buffer's.
    const c = ref.current as (Composer & { depthTexture?: THREE.DepthTexture | null }) | null
    const depth = c?.inputBuffer.depthTexture ?? c?.depthTexture
    if (!c || !depth) return
    for (const pass of c.passes) {
      if (syncedDepth.get(pass) === depth) continue
      pass.setDepthTexture(depth)
      syncedDepth.set(pass, depth)
    }
  })

  const effects: ReactElement[] = []
  // The cartoon look works on the raw render, before glow and grading.
  if (cartoon) effects.push(<Cartoon key="cartoon" />)
  if (e.depthOfField) effects.push(<FocusPass key="dof" points={e.focusPoints} range={e.dofRange} blur={e.dofBlur} />)
  if (e.godRays && sun)
    effects.push(
      <GodRays
        key="godrays"
        sun={sun}
        samples={120}
        density={0.98}
        decay={0.965}
        weight={0.9}
        exposure={e.godRaysIntensity}
        clampMax={1}
        blur
      />
    )
  if (e.burst)
    effects.push(
      <CustomEffect
        key="burst"
        make={() => new SpeedBurstEffect()}
        apply={(x) => x.setBurst(e.burstX, e.burstY, e.burstAmount, e.burstClear)}
      />
    )
  if (e.streaks)
    effects.push(
      <CustomEffect
        key="streaks"
        make={() => new AnamorphicEffect()}
        apply={(x) => x.setStreaks(e.streakAmount, e.streakThreshold, e.streakColor)}
      />
    )
  if (e.bloom)
    effects.push(
      <Bloom key="bloom" intensity={e.bloomIntensity} luminanceThreshold={e.bloomThreshold} mipmapBlur radius={0.7} />
    )
  if (hasGrade(e))
    effects.push(
      <CustomEffect
        key="grade"
        make={() => new ColorGradeEffect()}
        apply={(g) =>
          g.set({
            exposure: e.exposure,
            contrast: e.contrast,
            saturation: e.saturation,
            temperature: e.temperature,
            tint: e.tint,
            shadowTint: e.shadowTint,
            highlightTint: e.highlightTint,
            split: e.split
          })
        }
      />
    )
  // The look comes after the manual adjustments, like a creative LUT after primary correction.
  if (e.look) effects.push(<LookPass key="look" look={e.look} intensity={e.lookIntensity} lutMediaId={e.lutMediaId} />)
  if (e.chromatic)
    effects.push(
      <ChromaticAberration
        key="ca"
        offset={new THREE.Vector2(e.chromaticAmount, e.chromaticAmount)}
        radialModulation
        modulationOffset={0.2}
      />
    )
  // CRT before the always-on-top layers keeps titles clean; "over everything" moves it after them (below).
  if (e.warp)
    effects.push(<CustomEffect key="warp" make={() => new LensWarpEffect()} apply={(x) => x.setAmount(e.warpAmount)} />)
  const crtOverLayers = e.crt && e.crtOverLayers && e.cleanOverlays
  if (e.crt && !crtOverLayers) effects.push(<CrtPass key="crt" amount={e.crtAmount} curve={e.crtCurve} />)
  if (e.vignette)
    effects.push(<Vignette key="vig" darkness={e.vignetteDarkness} offset={e.vignetteOffset} eskil={false} />)
  if (e.grain) effects.push(<Noise key="grain" opacity={e.grainAmount} blendFunction={BlendFunction.OVERLAY} />)
  // God rays need the scene's depth to know what blocks the sun, which multisampled buffers don't
  // expose. With rays on we render without MSAA and smooth edges with SMAA instead.
  if (crtOverLayers) {
    effects.push(<OverlayPass key="overlays" />)
    effects.push(<CrtPass key="crt-all" amount={e.crtAmount} curve={e.crtCurve} />)
  }
  const msaa = e.godRays ? 0 : 4
  if (!msaa) effects.push(<SMAA key="smaa" />)
  chain.active = active && effects.length > 0
  chain.includesOverlays = crtOverLayers

  return (
    <>
      <FrameFinisher />
      {e.godRays && <Sun onMesh={setSun} />}
      {active && effects.length > 0 && (
        <EffectComposer
          // Rebuild whenever the set of effects changes: reusing the chain could leave a removed effect's
          // stale output on screen (seen when a scene with depth of field gave way to one without).
          key={`${msaa}|${effects.map((x) => x.key).join(',')}`}
          ref={ref}
          multisampling={msaa}
          frameBufferType={THREE.HalfFloatType}
          // The god-rays pass copies scene depth and then draws the sun against it; auto-clearing
          // would wipe that depth and the sun would shine through everything.
          autoClear={false}
        >
          {effects}
        </EffectComposer>
      )}
    </>
  )
}

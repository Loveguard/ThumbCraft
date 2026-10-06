import { useFrame } from '@react-three/fiber'
import { Bloom, ChromaticAberration, EffectComposer, GodRays, Noise, SMAA, Vignette } from '@react-three/postprocessing'
import { BlendFunction, LUT3DEffect, type EffectComposer as Composer, type Pass } from 'postprocessing'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import * as THREE from 'three'
import { useStore, type EffectSettings, type SceneSettings } from '../store'
import { ColorGrade } from './colorGrade'
import { withShaderLook } from '../renderModes'
import { Cartoon } from './cartoon'
import { FocusBlurEffect } from './focusBlur'
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
  hasGrade(e) || !!e.look || e.vignette || e.grain || e.bloom || e.godRays || e.chromatic || e.depthOfField

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

  useEffect(() => {
    composerHandle.current = active ? ref.current : null
  })

  // Runs before the composer renders (priority 0 < 1): keep every pass on the composer's current depth.
  useFrame(() => {
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
  if (e.bloom)
    effects.push(
      <Bloom key="bloom" intensity={e.bloomIntensity} luminanceThreshold={e.bloomThreshold} mipmapBlur radius={0.7} />
    )
  if (hasGrade(e))
    effects.push(
      <ColorGrade
        key="grade"
        exposure={e.exposure}
        contrast={e.contrast}
        saturation={e.saturation}
        temperature={e.temperature}
        tint={e.tint}
        shadowTint={e.shadowTint}
        highlightTint={e.highlightTint}
        split={e.split}
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
  if (e.vignette)
    effects.push(<Vignette key="vig" darkness={e.vignetteDarkness} offset={e.vignetteOffset} eskil={false} />)
  if (e.grain) effects.push(<Noise key="grain" opacity={e.grainAmount} blendFunction={BlendFunction.OVERLAY} />)
  // God rays need the scene's depth to know what blocks the sun, which multisampled buffers don't
  // expose. With rays on we render without MSAA and smooth edges with SMAA instead.
  const msaa = e.godRays ? 0 : 4
  if (!msaa) effects.push(<SMAA key="smaa" />)

  return (
    <>
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

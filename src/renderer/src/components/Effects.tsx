import { useFrame, useThree } from '@react-three/fiber'
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  GodRays,
  Noise,
  SMAA,
  Vignette
} from '@react-three/postprocessing'
import { BlendFunction, type EffectComposer as Composer, type Pass } from 'postprocessing'
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import * as THREE from 'three'
import { NO_EFFECTS, useStore, type EffectSettings, type SceneSettings } from '../store'
import { ColorGrade } from './colorGrade'
import { withShaderLook } from '../renderModes'
import { Cartoon } from './cartoon'

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
  hasGrade(e) || e.vignette || e.grain || e.bloom || e.godRays || e.chromatic || e.depthOfField

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
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null
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
  if (e.depthOfField)
    effects.push(
      <DepthOfField
        key="dof"
        target={controls?.target ?? new THREE.Vector3()}
        worldFocusRange={e.dofRange}
        bokehScale={e.dofBlur}
      />
    )
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

/** One-click looks. `sunInView` presets also move the sun into the shot. */
export const EFFECT_PRESETS: Record<string, Partial<EffectSettings> & { sunInView?: boolean }> = {
  None: NO_EFFECTS,
  Cinematic: {
    ...NO_EFFECTS,
    contrast: 0.18,
    saturation: -0.05,
    shadowTint: '#2f7d8c',
    highlightTint: '#ffa257',
    split: 0.3,
    vignette: true,
    vignetteDarkness: 0.5,
    bloom: true,
    bloomIntensity: 0.4,
    bloomThreshold: 0.85,
    grain: true,
    grainAmount: 0.06
  },
  'Sun glow': {
    ...NO_EFFECTS,
    exposure: 0.1,
    temperature: 0.75,
    contrast: 0.12,
    saturation: 0.2,
    shadowTint: '#6e4f86',
    highlightTint: '#ffb040',
    split: 0.45,
    godRays: true,
    godRaysIntensity: 0.9,
    sunColor: '#ffbf66',
    bloom: true,
    bloomIntensity: 0.7,
    bloomThreshold: 0.7,
    vignette: true,
    vignetteDarkness: 0.45,
    sunInView: true
  },
  Vibrant: { ...NO_EFFECTS, contrast: 0.22, saturation: 0.4, exposure: 0.05, vignette: true, vignetteDarkness: 0.4 },
  Dreamy: {
    ...NO_EFFECTS,
    exposure: 0.15,
    contrast: -0.15,
    tint: 0.15,
    temperature: 0.1,
    bloom: true,
    bloomIntensity: 1.2,
    bloomThreshold: 0.55,
    depthOfField: true,
    dofBlur: 1.5,
    dofRange: 12
  },
  Retro: {
    ...NO_EFFECTS,
    saturation: -0.4,
    temperature: 0.3,
    contrast: -0.05,
    shadowTint: '#6a5a3c',
    highlightTint: '#ffe0a8',
    split: 0.3,
    grain: true,
    grainAmount: 0.22,
    vignette: true,
    vignetteDarkness: 0.7,
    chromatic: true,
    chromaticAmount: 0.002
  },
  Moonlit: {
    ...NO_EFFECTS,
    exposure: -1.1,
    temperature: -0.55,
    saturation: -0.3,
    contrast: 0.12,
    vignette: true,
    vignetteDarkness: 0.75,
    bloom: true,
    bloomIntensity: 0.8,
    bloomThreshold: 0.5
  },
  Horror: {
    ...NO_EFFECTS,
    exposure: -0.5,
    saturation: -0.65,
    contrast: 0.3,
    tint: -0.2,
    vignette: true,
    vignetteDarkness: 0.9,
    grain: true,
    grainAmount: 0.15,
    chromatic: true,
    chromaticAmount: 0.003
  }
}

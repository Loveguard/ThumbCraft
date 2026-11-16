// Adding lights: presets for common thumbnail lighting, placed relative to what the user is looking at.
import * as THREE from 'three'
import { viewport } from './components/Viewport'
import { newId, useStore, type LightObject, type Vec3 } from './store'
import { isLit } from './renderModes'

type LightPreset = Pick<
  LightObject,
  'lightType' | 'color' | 'intensity' | 'range' | 'angle' | 'softness' | 'shadows' | 'gobo'
> & {
  name: string
}

export const LIGHT_PRESETS: { id: string; hint: string; light: LightPreset }[] = [
  {
    id: 'Point light',
    hint: 'A bulb that shines in every direction',
    light: {
      name: 'Point light',
      lightType: 'point',
      color: '#ffe2b8',
      intensity: 25,
      range: 14,
      angle: 45,
      softness: 0.4,
      shadows: false,
      gobo: null
    }
  },
  {
    id: 'Spotlight',
    hint: 'A cone of light aimed at what you are looking at',
    light: {
      name: 'Spotlight',
      lightType: 'spot',
      color: '#ffffff',
      intensity: 150,
      range: 40,
      angle: 40,
      softness: 0.35,
      shadows: true,
      gobo: null
    }
  },
  {
    id: 'Rim light',
    hint: 'Cool light from behind that outlines your subject',
    light: {
      name: 'Rim light',
      lightType: 'spot',
      color: '#5aa8ff',
      intensity: 200,
      range: 40,
      angle: 35,
      softness: 0.5,
      shadows: false,
      gobo: null
    }
  },

  {
    id: 'Window shadows',
    hint: 'Sunlight through a window frame',
    light: {
      name: 'Window light',
      lightType: 'spot',
      color: '#ffe9c4',
      intensity: 260,
      range: 50,
      angle: 35,
      softness: 0.15,
      shadows: true,
      gobo: 'window'
    }
  },
  {
    id: 'Leaf shadows',
    hint: 'Dappled light, like under a tree',
    light: {
      name: 'Dappled light',
      lightType: 'spot',
      color: '#fff3d1',
      intensity: 260,
      range: 50,
      angle: 45,
      softness: 0.2,
      shadows: true,
      gobo: 'leaves'
    }
  }
]

/** Rotation (degrees) that points a spotlight's +Z from `from` at `to`. */
export function aimAt(from: Vec3, to: Vec3): Vec3 {
  const aim = new THREE.Object3D()
  aim.position.fromArray(from)
  aim.lookAt(new THREE.Vector3().fromArray(to))
  return [aim.rotation.x, aim.rotation.y, aim.rotation.z].map(
    (r) => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10
  ) as Vec3
}

/**
 * Adds a light near the centre of the view. Point lights float just in front of the subject; spotlights sit
 * above and in front (behind it for the rim light) and aim at it.
 */
export function addLight(presetId: string): void {
  const preset = LIGHT_PRESETS.find((p) => p.id === presetId)!.light
  const point = viewport.placement?.().point ?? new THREE.Vector3(0, 0, 0)
  const cam = viewport.camera?.position ?? new THREE.Vector3(6, 4, 8)
  const toCam = cam.clone().sub(point).setY(0)
  if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1)
  toCam.normalize()
  const behind = presetId === 'Rim light' ? -1 : 1
  const pos =
    preset.lightType === 'point'
      ? point
          .clone()
          .addScaledVector(toCam, 1.2)
          .add(new THREE.Vector3(0, 2, 0))
      : point
          .clone()
          .addScaledVector(toCam, 4 * behind)
          .add(new THREE.Vector3(0, 5, 0))
  const rotation = aimAt(
    pos.toArray(),
    point
      .clone()
      .add(new THREE.Vector3(0, 1, 0))
      .toArray()
  ) // the subject's middle

  const s = useStore.getState()
  // Placed lights only light lit materials, which is Cinematic mode.
  if (!isLit(s.settings.renderMode)) {
    s.setSettings({ renderMode: 'cinematic' })
    s.setStatus('Switched to Cinematic so lights and shadows show.')
  }
  s.add({
    id: newId('obj'),
    kind: 'light',
    visible: true,
    position: [pos.x, pos.y, pos.z],
    rotation,
    scale: 1,
    ...preset
  })
}

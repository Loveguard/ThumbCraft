// Scene backdrop: vanilla biome sky, physical skies with clouds, night, the End, solid colour, or an
// uploaded equirectangular HDRI/panorama (which can also light the scene in Cinematic mode).
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { stripNs } from '@shared/minecraft/blockModel'
import { hexColor as hex } from '../image'
import { assetUrl, loadImage } from '../minecraft/assets'
import { setSkyDarken } from '../minecraft/lighting'
import { mediaStore } from '../media'
import { terrainStore, useStore, type SkyPreset, type TerrainObject } from '../store'
import { sunDirection } from './Effects'
import { errorText } from '../errors'
import { isLit } from '../renderModes'

/** Physical-sky parameters per preset (Preetham model + the built-in cloud layer). */
const PHYSICAL: Partial<
  Record<
    SkyPreset,
    {
      turbidity: number
      rayleigh: number
      mie: number
      g: number
      clouds: number
      density: number
      fog: string
      exposure: number
    }
  >
> = {
  clear: { turbidity: 2, rayleigh: 1, mie: 0.004, g: 0.8, clouds: 0.25, density: 0.35, fog: '#bcd3f0', exposure: 0.55 },
  golden: {
    turbidity: 6,
    rayleigh: 2.2,
    mie: 0.01,
    g: 0.92,
    clouds: 0.35,
    density: 0.4,
    fog: '#f0c38e',
    exposure: 0.6
  },
  sunset: {
    turbidity: 9,
    rayleigh: 3,
    mie: 0.02,
    g: 0.95,
    clouds: 0.45,
    density: 0.45,
    fog: '#e58b5d',
    exposure: 0.65
  },
  overcast: {
    turbidity: 10,
    rayleigh: 0.6,
    mie: 0.01,
    g: 0.7,
    clouds: 0.95,
    density: 0.9,
    fog: '#a2aab3',
    exposure: 0.2
  }
}

/**
 * How dark the game's sky light is for each look (Level.getSkyDarken): 1 at noon, ~0.76 in golden hour,
 * ~0.46 with the sun on the horizon, 0.75 in rain, 0.2 at midnight. Drives the vanilla lightmap.
 */
const SKY_DARKEN: Partial<Record<SkyPreset, number>> = { golden: 0.76, sunset: 0.46, overcast: 0.75, night: 0.2 }

/** Presets that also move the sun to fit the look (elevation in degrees). */
export const PRESET_SUN: Partial<Record<SkyPreset, number>> = { clear: 45, golden: 7, sunset: 2, overcast: 50 }

/** Applies a simple filmic curve inside the sky shader (the app renders untonemapped for vanilla colours). */
function makeSky(): Sky {
  const sky = new Sky()
  sky.scale.setScalar(1500)
  const mat = sky.material as THREE.ShaderMaterial
  mat.uniforms.skyExposure = { value: 0.55 }
  mat.fragmentShader =
    'uniform float skyExposure;\n' +
    mat.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      'vec3 x = gl_FragColor.rgb * skyExposure;\n' +
        'gl_FragColor.rgb = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);'
    )
  return sky
}

/** Starry night as an equirectangular texture, with the game's own moon texture when available. */
async function nightTexture(): Promise<THREE.Texture> {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 1024
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, c.height)
  grad.addColorStop(0, '#03050c')
  grad.addColorStop(0.48, '#0b1226')
  grad.addColorStop(0.5, '#141d38')
  grad.addColorStop(1, '#05070d')
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  // Deterministic star field (same sky every time a project opens).
  let seed = 1337
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * c.width
    const y = rnd() * c.height * 0.5
    const b = Math.pow(rnd(), 3)
    g.fillStyle = `rgba(255,255,255,${0.25 + b * 0.75})`
    const s = b > 0.85 ? 2 : 1
    g.fillRect(Math.floor(x), Math.floor(y), s, s)
  }
  const moon = await loadImage(assetUrl('environment/moon_phases'))
  if (moon) {
    // moon_phases is a 4×2 grid; phase 0 is the full moon. Drawn pixelated, like in-game.
    const fw = moon.width / 4
    const fh = moon.height / 2
    g.imageSmoothingEnabled = false
    g.drawImage(moon, 0, 0, fw, fh, c.width * 0.62, c.height * 0.2, 64, 64)
  }
  const t = new THREE.CanvasTexture(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** The End's sky: the jar's end_sky texture tiled 16× on each face of a box, tinted 40/255 like vanilla. */
async function endTexture(): Promise<THREE.Texture> {
  const tile = await loadImage(assetUrl('environment/end_sky'))
  const faces = Array.from({ length: 6 }, () => {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.fillStyle = '#0b0910'
    g.fillRect(0, 0, 1024, 1024)
    if (tile) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) g.drawImage(tile, x * 64, y * 64, 64, 64)
      g.globalCompositeOperation = 'multiply'
      g.fillStyle = 'rgb(40,40,40)'
      g.fillRect(0, 0, 1024, 1024)
    }
    return c
  })
  const t = new THREE.CubeTexture(faces)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

async function hdriTexture(mediaId: string): Promise<THREE.Texture | null> {
  const m = mediaStore.get(mediaId)
  if (!m) return null
  const name = m.name.toLowerCase()
  let t: THREE.Texture
  if (name.endsWith('.hdr')) t = await new HDRLoader().loadAsync(m.url)
  else if (name.endsWith('.exr')) t = await new EXRLoader().loadAsync(m.url)
  else {
    t = await new THREE.TextureLoader().loadAsync(m.url)
    t.colorSpace = THREE.SRGBColorSpace
  }
  t.mapping = THREE.EquirectangularReflectionMapping
  return t
}

export function SkyBackdrop(): ReactNode {
  const { scene } = useThree()
  const sky = useStore((s) => s.sky)
  const { fog, renderMode, sunAzimuth, sunElevation } = useStore((s) => s.settings)
  // Only the first terrain matters here; editing other objects must not re-run the sky set-up.
  const terrainId = useStore((s) => s.objects.find((o): o is TerrainObject => o.kind === 'terrain')?.terrainId)
  const assets = useStore((s) => s.assets)
  const physicalSky = useMemo(makeSky, [])
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  // Vanilla look: the first terrain's biome decides sky and fog colour, as in-game.
  const biome = useMemo(() => {
    const data = terrainId ? terrainStore.get(terrainId) : undefined
    if (!data || !assets) return null
    const centre = data.biomes[Math.floor(data.sizeX / 2) + Math.floor(data.sizeZ / 2) * data.sizeX]
    const b = assets.biomes[stripNs(data.biomePalette[centre] ?? '')]
    return { b, dimension: data.dimension, size: Math.max(data.sizeX, data.sizeZ) }
  }, [terrainId, assets])

  const preset = sky.preset
  const solid = sky.color

  useEffect(() => {
    let alive = true
    setTexture(null)
    const load =
      preset === 'night'
        ? nightTexture()
        : preset === 'end'
          ? endTexture()
          : preset === 'hdri' && sky.hdriMediaId
            ? hdriTexture(sky.hdriMediaId)
            : null
    load?.then(
      (t) => alive && setTexture(t),
      (e) => useStore.getState().setStatus(`Couldn't load the sky image: ${errorText(e)}`)
    )
    return () => {
      alive = false
    }
  }, [preset, sky.hdriMediaId])
  useEffect(() => () => texture?.dispose(), [texture])

  useEffect(() => setSkyDarken(SKY_DARKEN[preset] ?? 1), [preset])

  const phys = PHYSICAL[preset]
  useEffect(() => {
    if (!phys) return
    const u = (physicalSky.material as THREE.ShaderMaterial).uniforms
    u.turbidity.value = phys.turbidity
    u.rayleigh.value = phys.rayleigh
    u.mieCoefficient.value = phys.mie
    u.mieDirectionalG.value = phys.g
    if (u.cloudCoverage) u.cloudCoverage.value = phys.clouds
    if (u.cloudDensity) u.cloudDensity.value = phys.density
    u.skyExposure.value = phys.exposure * sky.intensity
    u.sunPosition.value.copy(sunDirection(sunAzimuth, sunElevation))
  }, [phys, physicalSky, sunAzimuth, sunElevation, sky.intensity])

  useEffect(() => {
    const rot = THREE.MathUtils.degToRad(sky.rotation)
    scene.backgroundRotation.set(0, rot, 0)
    scene.environmentRotation.set(0, rot, 0)
    scene.backgroundIntensity = sky.intensity
    scene.environment = null
    scene.environmentIntensity = 1

    let fogColor: string | null = null
    if (preset === 'biome') {
      const b = biome?.b
      const c = biome?.dimension === 'overworld' ? b?.effects.sky_color : b?.effects.fog_color
      scene.background = new THREE.Color(hex(c, '#78a7ff'))
      fogColor = hex(b?.effects.fog_color, hex(c, '#78a7ff'))
    } else if (preset === 'color') {
      scene.background = new THREE.Color(solid)
      fogColor = solid
    } else if (preset === 'nether') {
      const c = biome?.dimension === 'the_nether' ? hex(biome.b?.effects.fog_color, '#330808') : '#330808'
      scene.background = new THREE.Color(c)
      fogColor = c
    } else if (phys) {
      scene.background = null // the physical sky mesh draws itself
      fogColor = phys.fog
    } else {
      scene.background = texture
      if (preset === 'night') fogColor = '#0d1428'
      if (preset === 'end') fogColor = '#0b0910'
      if (preset === 'hdri' && texture && sky.lighting && isLit(renderMode)) scene.environment = texture
    }

    // Reuse one Fog object: a new one makes every material re-check its shader program.
    if (fog && biome && fogColor) {
      const f = scene.fog instanceof THREE.Fog ? scene.fog : new THREE.Fog(0)
      f.color.set(fogColor)
      f.near = biome.size * 0.9
      f.far = biome.size * 2.2
      scene.fog = f
    } else scene.fog = null
  }, [scene, preset, solid, biome, phys, texture, fog, sky.rotation, sky.intensity, sky.lighting, renderMode])

  return phys ? <primitive object={physicalSky} /> : null
}

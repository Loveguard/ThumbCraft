// Rain and snow drawn the way the game draws them: one camera-facing strip per block column, textured with
// environment/rain.png or snow.png (repeating every 4 blocks), from the ground up, fading towards the edge
// of the area. Columns stop on the terrain's top solid block, so rain doesn't fall through roofs or trees.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { assetUrl, loadImage } from '../minecraft/assets'
import { terrainStore, useStore, type SceneObject, type WeatherType } from '../store'

/** Radius (blocks) around the view's focus that gets weather. */
const RADIUS = 28
/** How far above the ground or the focus point the strips reach. */
const ABOVE = 30

/** Blocks rain and snow fall through (vanilla's motion-blocking heightmap ignores them). */
const PASS_THROUGH =
  /(^|_)(air|grass|fern|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|roots|fungus|bush|sapling|torch|snow|vine|carpet|button|lever|rail|sign|wire|sprouts|petals)$|tall_grass|short_grass|redstone_wire/

const hash = (x: number, z: number, salt: number): number => {
  let h = Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(salt, 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** World height of the highest blocking surface at (x, z) across the scene's terrains, or null. */
function makeGround(objects: SceneObject[]): (x: number, z: number) => number | null {
  const sources = objects.flatMap((o) => {
    if (o.kind !== 'terrain' || !o.visible) return []
    const t = terrainStore.get(o.terrainId)
    if (!t) return []
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...o.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...(o.rotation.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]))
      ),
      new THREE.Vector3(o.scale, o.scale, o.scale)
    )
    const blocking = t.palette.map((b) => !PASS_THROUGH.test(b.name.replace('minecraft:', '')))
    return [{ t, m, inv: m.clone().invert(), blocking }]
  })
  const p = new THREE.Vector3()
  return (x, z) => {
    let best: number | null = null
    for (const { t, m, inv, blocking } of sources) {
      // Column in the terrain's own grid (its mesh is centred on x/z).
      p.set(x, 0, z).applyMatrix4(inv)
      const i = Math.floor(p.x + t.sizeX / 2)
      const k = Math.floor(p.z + t.sizeZ / 2)
      if (i < 0 || k < 0 || i >= t.sizeX || k >= t.sizeZ) continue
      for (let y = t.sizeY - 1; y >= 0; y--)
        if (blocking[t.blocks[i + k * t.sizeX + y * t.sizeX * t.sizeZ]]) {
          const top = p.set(i - t.sizeX / 2 + 0.5, y + 1, k - t.sizeZ / 2 + 0.5).applyMatrix4(m).y
          best = best === null ? top : Math.max(best, top)
          break
        }
    }
    return best
  }
}

function weatherMaterial(map: THREE.Texture, brightness: number, wind: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color(brightness, brightness, brightness),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    alphaTest: 0.01
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = { value: wind }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aCenter;
attribute float aHeight;
attribute float aV;
attribute float aAlpha;
uniform float uWind;
varying float vAlpha;`
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 toCam = cameraPosition - aCenter;
toCam.y = 0.0;
vec3 side = length(toCam) > 0.001 ? normalize(vec3(toCam.z, 0.0, -toCam.x)) : vec3(1.0, 0.0, 0.0);
float hy = position.y * aHeight;
vec3 transformed = aCenter + side * position.x + vec3(uWind * hy, hy, 0.0);
vAlpha = aAlpha;`
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
vMapUv = vec2(uv.x, uv.y * aHeight * 0.25 + aV);
#endif`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vAlpha;')
  }
  return mat
}

function useWeatherTexture(type: WeatherType): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (type === 'none') return
    let alive = true
    let made: THREE.Texture | null = null
    void loadImage(assetUrl(type === 'snow' ? 'environment/snow' : 'environment/rain')).then((img) => {
      if (!alive || !img) return
      made = new THREE.Texture(img)
      made.magFilter = THREE.NearestFilter
      made.minFilter = THREE.NearestFilter
      made.generateMipmaps = false
      made.wrapT = THREE.RepeatWrapping
      made.colorSpace = THREE.SRGBColorSpace
      made.needsUpdate = true
      setTex(made)
    })
    return () => {
      alive = false
      made?.dispose()
      setTex(null)
    }
  }, [type])
  return tex
}

export function Weather(): ReactNode {
  const type = useStore((s) => s.settings.weather)
  const density = useStore((s) => s.settings.weatherDensity)
  const wind = useStore((s) => s.settings.wind)
  const objects = useStore((s) => s.objects)
  const night = useStore((s) => s.sky.preset === 'night')
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null
  const tex = useWeatherTexture(type)
  // The weather follows the view's focus in 4-block steps, so orbiting doesn't rebuild it.
  const [focus, setFocus] = useState<[number, number, number]>([0, 0, 0])
  useFrame(() => {
    const t = controls?.target
    if (!t || type === 'none') return
    const f: [number, number, number] = [Math.round(t.x / 4) * 4, Math.round(t.y / 4) * 4, Math.round(t.z / 4) * 4]
    if (f[0] !== focus[0] || f[1] !== focus[1] || f[2] !== focus[2]) setFocus(f)
  })

  const geometry = useMemo(() => {
    if (type === 'none') return null
    const ground = makeGround(objects)
    const centers: number[] = []
    const heights: number[] = []
    const vs: number[] = []
    const alphas: number[] = []
    const [fx, fy, fz] = focus
    for (let z = fz - RADIUS; z <= fz + RADIUS; z++)
      for (let x = fx - RADIUS; x <= fx + RADIUS; x++) {
        const d = Math.hypot(x - fx, z - fz)
        if (d > RADIUS || hash(x, z, 1) >= density) continue
        const g = ground(x + 0.5, z + 0.5) ?? 0
        const top = Math.max(g, fy) + ABOVE
        centers.push(x + 0.5, g, z + 0.5)
        heights.push(top - g)
        vs.push(hash(x, z, 2) * 4)
        // Like vanilla: full strength near the middle, half at the edge.
        alphas.push((1 - (d * d) / (RADIUS * RADIUS)) * 0.5 + 0.5)
      }
    const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
    const g = new THREE.InstancedBufferGeometry()
    g.index = plane.index
    g.setAttribute('position', plane.getAttribute('position'))
    g.setAttribute('uv', plane.getAttribute('uv'))
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3))
    g.setAttribute('aHeight', new THREE.InstancedBufferAttribute(new Float32Array(heights), 1))
    g.setAttribute('aV', new THREE.InstancedBufferAttribute(new Float32Array(vs), 1))
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(alphas), 1))
    g.instanceCount = heights.length
    return g
  }, [type, density, objects, focus])
  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(
    () => (tex ? weatherMaterial(tex, night ? 0.12 : 0.75, type === 'snow' ? wind * 0.6 : wind * 0.35) : null),
    [tex, night, wind, type]
  )
  useEffect(() => () => material?.dispose(), [material])

  if (!geometry || !material) return null
  // Not clickable: the strips are placed in the shader, so picking would hit an invisible square at the origin.
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={500} raycast={() => null} />
}

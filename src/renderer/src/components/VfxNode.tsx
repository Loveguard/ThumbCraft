import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { assetUrl, loadImage } from '../minecraft/assets'
import type { VfxObject } from '../store'
import { MOTION_KINDS, vfxBounds, vfxLayers, type PuffLayer } from '../vfx'
import { EFFECT_TIME, onEffectTime } from '../effectClock'

/** Soft, slightly ragged round puff (smoke, fog, flame), a sharp glowing dot (sparks) or a twinkle, drawn once. */
const textures: Partial<Record<PuffLayer['texture'], THREE.Texture>> = {}
function puffTexture(kind: PuffLayer['texture']): THREE.Texture {
  const cached = textures[kind]
  if (cached) return cached
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  if (kind === 'star') {
    // A four-point twinkle: two thin streaks crossing over a small soft core, like light catching a gem.
    const mid = size / 2
    const core = g.createRadialGradient(mid, mid, 0, mid, mid, size * 0.22)
    core.addColorStop(0, 'rgba(255,255,255,1)')
    core.addColorStop(0.3, 'rgba(255,255,255,0.55)')
    core.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = core
    g.fillRect(0, 0, size, size)
    g.globalCompositeOperation = 'lighter'
    for (const [w, h] of [
      [size, size * 0.07],
      [size * 0.07, size]
    ]) {
      const streak = g.createRadialGradient(mid, mid, 0, mid, mid, mid)
      streak.addColorStop(0, 'rgba(255,255,255,1)')
      streak.addColorStop(0.35, 'rgba(255,255,255,0.5)')
      streak.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = streak
      g.beginPath()
      // A spindle: wide in the middle, pointed at both ends.
      if (w > h) {
        g.moveTo(0, mid)
        g.quadraticCurveTo(mid, mid - h, size, mid)
        g.quadraticCurveTo(mid, mid + h, 0, mid)
      } else {
        g.moveTo(mid, 0)
        g.quadraticCurveTo(mid + w, mid, mid, size)
        g.quadraticCurveTo(mid - w, mid, mid, 0)
      }
      g.fill()
    }
  } else if (kind === 'spark') {
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.25, 'rgba(255,255,255,0.8)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    // A few soft lumps so puffs don't read as perfect circles.
    let seed = 7
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 40; i++) {
      const x = rnd() * size
      const y = rnd() * size
      const r = 6 + rnd() * 16
      const hole = g.createRadialGradient(x, y, 0, x, y, r)
      hole.addColorStop(0, 'rgba(0,0,0,0.35)')
      hole.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = hole
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  textures[kind] = t
  return t
}

const vertexShader = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec4 iColor;
  attribute vec2 iSizeRot;
  attribute float iPhase;
  uniform float uTime;
  uniform float uMove;
  uniform float uKind;
  uniform float uSpeed;
  uniform float uTravel;
  uniform float uBurst;
  varying vec2 vUv;
  varying vec4 vColor;
  const float TAU = 6.2831853;
  void main() {
    vUv = uv;
    vec3 off = iOffset;
    float size = iSizeRot.x;
    float rot = iSizeRot.y;
    float alpha = 1.0;
    if (uMove > 0.5) {
      float t = uTime;
      if (uKind < 0.5) {
        // Rise: through its own spot and on, fading in and out so the start over is never seen.
        float u = fract(t * uSpeed / uTravel + iPhase);
        off.y += (u - 0.5) * uTravel;
        off.x += sin(t * 0.7 + iPhase * TAU) * 0.08 * uTravel;
        rot += t * 0.25 * (iPhase - 0.5);
        alpha = min(1.0, sin(3.14159 * u) * 1.6);
      } else if (uKind < 1.5) {
        // Flicker: a flame licks up from its spot, shrinking as it goes.
        float u = fract(t * uSpeed / uTravel + iPhase);
        off.y += u * uTravel;
        size *= 1.15 - 0.6 * u;
        alpha = min(1.0, smoothstep(0.0, 0.15, u) * (1.0 - u) * 2.2);
      } else if (uKind < 2.5) {
        // Swirl: round the middle, rising a little.
        float a = t * uSpeed;
        off.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * off.xz;
        float u = fract(t * 0.25 + iPhase);
        off.y += (u - 0.5) * uTravel;
        alpha = min(1.0, sin(3.14159 * u) * 1.6);
      } else if (uKind < 3.5) {
        // Drift: a slow wander about its spot.
        off.x += sin(t * uSpeed * TAU + iPhase * TAU) * uTravel;
        off.z += cos(t * uSpeed * 0.8 * TAU + iPhase * 9.1) * uTravel;
        rot += t * 0.1 * (iPhase - 0.5);
      } else if (uKind < 4.5) {
        // Twinkle: pulsing in size and brightness.
        float w = 0.5 + 0.5 * sin(t * uSpeed * TAU + iPhase * TAU);
        size *= 0.4 + 0.6 * w;
        alpha = 0.35 + 0.65 * w;
      } else {
        // Burst: it goes off at uBurst seconds. Before that there is nothing; as laid out is its peak.
        float k = t - uBurst;
        vec3 c0 = vec3(0.0, uTravel, 0.0);
        vec3 d = off - c0;
        if (k < 0.0) alpha = 0.0;
        else if (uSpeed < 0.5) {
          // The fireball swells fast, then burns out.
          float g = 1.0 - pow(1.0 - clamp(k / 0.35, 0.0, 1.0), 3.0);
          off = c0 + d * (0.2 + 0.8 * g + 0.15 * max(k - 0.35, 0.0));
          size *= 0.3 + 0.7 * g;
          alpha = k < 0.35 ? 1.0 : max(0.0, 1.0 - (k - 0.35) / 0.9);
        } else if (uSpeed < 1.5) {
          // The smoke rolls out behind it, keeps billowing up and thins away.
          float g = 1.0 - pow(1.0 - clamp(k / 0.6, 0.0, 1.0), 2.0);
          off = c0 + d * (0.3 + 0.7 * g + 0.12 * k);
          off.y += 0.35 * k;
          size *= 0.5 + 0.5 * g + 0.1 * k;
          alpha = smoothstep(0.0, 0.3, k) * max(0.0, 1.0 - max(k - 1.5, 0.0) / 2.5);
        } else {
          // Debris is thrown out and falls.
          float g = min(1.0, k / 0.35);
          off = c0 + d * (g * (2.0 - g) + 0.4 * max(k - 0.35, 0.0));
          off.y -= 4.0 * pow(max(k - 0.35, 0.0), 2.0);
          alpha = 1.0 - smoothstep(0.8, 1.6, k);
        }
      }
    }
    vColor = vec4(iColor.rgb, iColor.a * alpha);
    vec4 mv = modelViewMatrix * vec4(off, 1.0);
    float scale = length(modelMatrix[0].xyz);
    float c = cos(rot);
    float s = sin(rot);
    vec2 p = mat2(c, s, -s, c) * position.xy * size * scale;
    mv.xy += p;
    gl_Position = projectionMatrix * mv;
  }
`
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float opacity;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, t.a * vColor.a * opacity);
    #include <colorspace_fragment>
  }
`

/** One layer of camera-facing puffs as a single instanced draw. */
function PuffCloud({
  layer,
  color,
  opacity,
  still,
  burstAt
}: {
  layer: PuffLayer
  color: string
  opacity: number
  still: boolean
  burstAt: number
}): ReactNode {
  const geometry = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.getAttribute('position'))
    g.setAttribute('uv', base.getAttribute('uv'))
    const n = layer.puffs.length
    const offset = new Float32Array(n * 3)
    const colors = new Float32Array(n * 4)
    const sizeRot = new Float32Array(n * 2)
    const phase = new Float32Array(n)
    const tint = new THREE.Color(layer.color ?? color)
    layer.puffs.forEach((p, i) => {
      offset.set([p.x, p.y, p.z], i * 3)
      colors.set([tint.r * p.shade, tint.g * p.shade, tint.b * p.shade, p.alpha], i * 4)
      sizeRot.set([p.size, p.rot], i * 2)
      // Where in its own cycle each puff is, scattered so they don't move in step.
      phase[i] = (Math.sin(i * 12.9898 + p.rot * 78.233) * 43758.5453) % 1
    })
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offset, 3))
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 4))
    g.setAttribute('iSizeRot', new THREE.InstancedBufferAttribute(sizeRot, 2))
    g.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phase, 1))
    g.instanceCount = n
    return g
  }, [layer, color])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: puffTexture(layer.texture) },
          opacity: { value: 1 },
          uTime: EFFECT_TIME,
          uMove: { value: 0 },
          uKind: { value: 0 },
          uSpeed: { value: 0 },
          uTravel: { value: 1 },
          uBurst: { value: 0 }
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: layer.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
      }),
    [layer.texture, layer.blending]
  )
  material.uniforms.opacity.value = opacity
  material.uniforms.uKind.value = MOTION_KINDS.indexOf(layer.motion.kind)
  material.uniforms.uSpeed.value = layer.motion.speed
  material.uniforms.uTravel.value = layer.motion.travel
  material.uniforms.uBurst.value = burstAt
  useEffect(
    () => onEffectTime((_, moving) => void (material.uniforms.uMove.value = moving && !still ? 1 : 0)),
    [material, still]
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  // Instanced billboards can't be ray-picked; the effect's click box handles selection.
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={500} raycast={() => null} />
}

/** The game's own fire texture on two crossed planes, as the fire block is drawn in game. */
function GameFire({ color, still }: { color: string; still: boolean }): ReactNode {
  const [map, setMap] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    void loadImage(assetUrl('block/fire_0')).then((img) => {
      if (!img || !alive) return
      const t = new THREE.Texture(img)
      t.magFilter = THREE.NearestFilter
      t.minFilter = THREE.NearestFilter
      t.colorSpace = THREE.SRGBColorSpace
      // Animated strips stack frames vertically: a thumbnail shows the first, an animation plays them.
      t.repeat.set(1, img.width / img.height)
      t.offset.set(0, 1 - img.width / img.height)
      t.needsUpdate = true
      setMap(t)
    })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => () => map?.dispose(), [map])
  useEffect(() => {
    if (!map?.image) return
    const img = map.image as HTMLImageElement
    const frames = Math.max(1, Math.round(img.height / img.width))
    // The game shows a new frame of fire every tick (20 a second).
    return onEffectTime((t, moving) => {
      const frame = moving && !still ? Math.floor(t * 20) % frames : 0
      map.offset.y = 1 - (frame + 1) / frames
    })
  }, [map, still])
  if (!map) return null
  return (
    <group position={[0, 0.75, 0]} scale={1.5}>
      {[Math.PI / 4, -Math.PI / 4].map((a) => (
        <mesh key={a} rotation={[0, a, 0]} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={map}
            color={color}
            transparent
            alphaTest={0.1}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/** A soft additive cone of light coming down from above. */
function Beam({ color, opacity }: { color: string; opacity: number }): ReactNode {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color() }, opacity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 color;
          uniform float opacity;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            // Brightest through the middle of the shaft, fading at its edges and towards the ground.
            float edge = pow(abs(dot(vNormal, vView)), 1.5);
            float fade = smoothstep(0.0, 0.5, vUv.y);
            gl_FragColor = vec4(color, edge * fade * 0.35 * opacity);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      }),
    []
  )
  material.uniforms.color.value.set(color)
  material.uniforms.opacity.value = opacity
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh position={[0, 5, 0]} material={material} renderOrder={499} raycast={() => null}>
      <cylinderGeometry args={[0.35, 1.6, 10, 32, 1, true]} />
    </mesh>
  )
}

/** How tall the beacon beam is drawn (the game's reaches the sky; this is plenty for any shot). */
const BEACON_HEIGHT = 160

/**
 * A lit beacon's beam like the game draws it: a bright core column with the game's beam texture and a wider,
 * faint glow around it, both added onto what's behind.
 */
function BeaconBeam({ color, opacity }: { color: string; opacity: number }): ReactNode {
  const [map, setMap] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    void loadImage(assetUrl('entity/beacon_beam')).then((img) => {
      if (!alive || !img) return
      const t = new THREE.Texture(img)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(1, BEACON_HEIGHT / 4)
      t.magFilter = THREE.NearestFilter
      t.colorSpace = THREE.SRGBColorSpace
      t.needsUpdate = true
      setMap(t)
    })
    return () => {
      alive = false
    }
  }, [])
  const core = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      }),
    []
  )
  const glow = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      }),
    []
  )
  core.map = map
  core.color.set(color)
  core.opacity = 0.9 * opacity
  core.needsUpdate = true
  glow.color.set(color)
  glow.opacity = 0.18 * opacity
  useEffect(
    () => () => {
      core.dispose()
      glow.dispose()
      map?.dispose()
    },
    [core, glow, map]
  )
  // The tall beam doesn't count towards the object's centre (its handles stay at the beacon).
  return (
    <group userData={{ noCentre: true }}>
      <mesh position={[0, BEACON_HEIGHT / 2, 0]} material={core} renderOrder={499} raycast={() => null}>
        <boxGeometry args={[0.4, BEACON_HEIGHT, 0.4]} />
      </mesh>
      <mesh position={[0, BEACON_HEIGHT / 2, 0]} material={glow} renderOrder={499} raycast={() => null}>
        <boxGeometry args={[0.5, BEACON_HEIGHT, 0.5]} />
      </mesh>
    </group>
  )
}

export function VfxNode({ o, cinematic }: { o: VfxObject; cinematic: boolean }): ReactNode {
  const layers = useMemo(() => vfxLayers(o.effect, o.density, o.seed), [o.effect, o.density, o.seed])
  const [half, height] = vfxBounds(o.effect)
  const glowAt: Record<string, [number, number, number]> = {
    fire: [0, 1, 0],
    explosion: [0, 2, 0],
    beam: [0, 1, 0],
    totem: [0, 1.3, 0]
  }
  return (
    <>
      {o.effect === 'beam' && <Beam color={o.color} opacity={o.opacity} />}
      {o.effect === 'beacon' && <BeaconBeam color={o.color} opacity={o.opacity} />}
      {o.effect === 'fire' && <GameFire color="#ffffff" still={!!o.still} />}
      {layers.map((l, i) => (
        <PuffCloud
          key={`${o.effect}-${i}`}
          layer={l}
          color={o.color}
          opacity={o.opacity}
          still={!!o.still}
          burstAt={o.burstAt ?? 0}
        />
      ))}
      {o.glow && cinematic && (
        <pointLight
          position={glowAt[o.effect] ?? [0, 1, 0]}
          color={o.color}
          intensity={(o.effect === 'explosion' ? 90 : 25) * (0.4 + o.density) * o.opacity}
          distance={o.effect === 'explosion' ? 24 : 12}
          decay={2}
        />
      )}
      {/* Invisible box that makes the effect clickable in the viewport. */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[half * 2, height, half * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </>
  )
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { assetUrl, loadImage } from '../minecraft/assets'
import type { VfxObject } from '../store'
import { vfxBounds, vfxLayers, type PuffLayer } from '../vfx'

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
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    float scale = length(modelMatrix[0].xyz);
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 p = mat2(c, s, -s, c) * position.xy * iSizeRot.x * scale;
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
function PuffCloud({ layer, color, opacity }: { layer: PuffLayer; color: string; opacity: number }): ReactNode {
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
    const tint = new THREE.Color(layer.color ?? color)
    layer.puffs.forEach((p, i) => {
      offset.set([p.x, p.y, p.z], i * 3)
      colors.set([tint.r * p.shade, tint.g * p.shade, tint.b * p.shade, p.alpha], i * 4)
      sizeRot.set([p.size, p.rot], i * 2)
    })
    g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offset, 3))
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 4))
    g.setAttribute('iSizeRot', new THREE.InstancedBufferAttribute(sizeRot, 2))
    g.instanceCount = n
    return g
  }, [layer, color])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: puffTexture(layer.texture) }, opacity: { value: 1 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: layer.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending
      }),
    [layer.texture, layer.blending]
  )
  material.uniforms.opacity.value = opacity
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  // Instanced billboards can't be ray-picked; the effect's click box handles selection.
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={500} raycast={() => null} />
}

/** The game's own fire texture on two crossed planes, as the fire block is drawn in game. */
function GameFire({ color }: { color: string }): ReactNode {
  const [map, setMap] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    void loadImage(assetUrl('block/fire_0')).then((img) => {
      if (!img || !alive) return
      const t = new THREE.Texture(img)
      t.magFilter = THREE.NearestFilter
      t.minFilter = THREE.NearestFilter
      t.colorSpace = THREE.SRGBColorSpace
      // Animated strips stack frames vertically: show the first.
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
      {o.effect === 'fire' && <GameFire color="#ffffff" />}
      {layers.map((l, i) => (
        <PuffCloud key={`${o.effect}-${i}`} layer={l} color={o.color} opacity={o.opacity} />
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

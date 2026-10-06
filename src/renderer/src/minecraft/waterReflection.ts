// Reflective water: a hidden planar reflector at the main water level renders the mirrored scene, and the
// water surface blends it in (more at grazing angles, like real water).
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

let reflecting = false

/**
 * Only one planar reflection renders at a time: a reflector seen inside another one's reflection shows its
 * previous image instead of rendering the whole scene again (water + a mirror would otherwise multiply passes).
 */
export function guardReflector(r: Reflector, before?: () => void, after?: () => void): void {
  const render = r.onBeforeRender
  r.onBeforeRender = function (...args) {
    if (reflecting) return
    reflecting = true
    before?.()
    try {
      render.apply(this, args)
    } finally {
      after?.()
      reflecting = false
    }
  }
}

/** The most common height among the surface's vertices (the main sea or lake level). */
function mainLevel(positions: ArrayLike<number>): number | null {
  const counts = new Map<number, number>()
  for (let i = 1; i < positions.length; i += 3) {
    const y = Math.round(positions[i] * 1000) / 1000
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  let best: number | null = null
  let n = 0
  for (const [y, c] of counts) if (c > n) [best, n] = [y, c]
  return best
}

/**
 * Makes `surface` (the upward water faces) reflect the scene. Returns the reflector driver, added as a child
 * of the surface so it shares its transform.
 */
export function makeWaterReflective(surface: THREE.Mesh, sizeX: number, sizeZ: number): void {
  const level = mainLevel(surface.geometry.getAttribute('position').array)
  if (level === null) return
  const driver = new Reflector(new THREE.PlaneGeometry(sizeX, sizeZ), {
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.003,
    multisample: 0
  })
  driver.rotation.x = -Math.PI / 2
  driver.position.set(sizeX / 2, level, sizeZ / 2)
  // The driver draws nothing itself; it only renders the reflection when the scene is drawn.
  const dm = driver.material as THREE.ShaderMaterial
  dm.colorWrite = false
  dm.depthWrite = false
  dm.depthTest = false
  driver.frustumCulled = false
  driver.renderOrder = -1
  driver.userData.reflectionDriver = true
  // Invisible to clicks, snapping and placement.
  driver.raycast = () => {}
  // The water can't appear in its own reflection (it would sample the texture being drawn).
  guardReflector(
    driver,
    () => (surface.visible = false),
    () => (surface.visible = true)
  )
  surface.add(driver)

  const reflInverse = new THREE.Matrix4()
  surface.onBeforeRender = () => reflInverse.copy(driver.matrixWorld).invert()

  const mat = surface.material as THREE.Material
  const previous = mat.onBeforeCompile.bind(mat)
  mat.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    shader.uniforms.mcReflTex = { value: driver.getRenderTarget().texture }
    shader.uniforms.mcReflMatrix = { value: dm.uniforms.textureMatrix.value }
    shader.uniforms.mcReflInverse = { value: reflInverse }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform mat4 mcReflMatrix;\nuniform mat4 mcReflInverse;\nvarying vec4 vReflUv;\nvarying float vFresnel;'
      )
      .replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'vec4 mcWorld = modelMatrix * vec4(transformed, 1.0);',
          'vReflUv = mcReflMatrix * mcReflInverse * mcWorld;',
          'vFresnel = pow(1.0 - abs(normalize(cameraPosition - mcWorld.xyz).y), 2.0);'
        ].join('\n')
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D mcReflTex;\nvarying vec4 vReflUv;\nvarying float vFresnel;'
      )
      .replace(
        '#include <opaque_fragment>',
        [
          'float mcMix = mix(0.3, 0.85, vFresnel);',
          'outgoingLight = mix(outgoingLight, texture2DProj(mcReflTex, vReflUv).rgb, mcMix);',
          'diffuseColor.a = max(diffuseColor.a, mix(0.65, 0.95, vFresnel));',
          '#include <opaque_fragment>'
        ].join('\n')
      )
  }
  const key = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => `${key()}-water-reflect`
}

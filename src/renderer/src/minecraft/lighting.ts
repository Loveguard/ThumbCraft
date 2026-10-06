// Applies vanilla block/sky light to terrain materials. Vanilla mode multiplies by the game's lightmap;
// Cinematic mode keeps its real lights and adds the warm glow of torches, lava and glowstone on top, while
// sky light darkens the ambient fill in caves and under dense trees.
import * as THREE from 'three'
import { vanillaLightmap, type LightDimension } from '@shared/minecraft/light'

let skyDarken = 1
const lightmaps = new Map<LightDimension, THREE.DataTexture>()

function lightmapFor(dim: LightDimension): THREE.DataTexture {
  let t = lightmaps.get(dim)
  if (!t) {
    t = new THREE.DataTexture(vanillaLightmap(skyDarken, dim), 16, 16, THREE.RGBAFormat)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.needsUpdate = true
    lightmaps.set(dim, t)
  }
  return t
}

/** 1 at noon, 0.2 at midnight (Level.getSkyDarken). Rebuilds every lightmap in use. */
export function setSkyDarken(value: number): void {
  if (value === skyDarken) return
  skyDarken = value
  for (const [dim, t] of lightmaps) {
    ;(t.image.data as Uint8Array).set(vanillaLightmap(value, dim))
    t.needsUpdate = true
  }
}

/** How strongly glowing blocks light their surroundings in Cinematic mode. */
export const glowStrength = { value: 1.2 }

// Lightmap lookup: x = block light, y = sky light, each level sampled at its texel centre.
const LOOKUP = 'vec2((vMcLight.y * 15.0 + 0.5) / 16.0, (vMcLight.x * 15.0 + 0.5) / 16.0)'

export function applyBlockLight(mat: THREE.Material, dim: LightDimension, cinematic: boolean): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.mcLightmap = { value: lightmapFor(dim) }
    shader.uniforms.mcGlow = glowStrength
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 mcLight;\nvarying vec2 vMcLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMcLight = mcLight;')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform sampler2D mcLightmap;\nuniform float mcGlow;\nvarying vec2 vMcLight;'
    )
    if (!cinematic) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb *= texture2D(mcLightmap, ${LOOKUP}).rgb;`
      )
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        [
          '#include <lights_fragment_end>',
          // Sky light 0 (deep caves) keeps a little fill so nothing is pitch black.
          'reflectedLight.indirectDiffuse *= mix(0.08, 1.0, vMcLight.x * vMcLight.x);',
          // The lightmap's block-light row at sky light 0 is the game's warm torch colour.
          'vec3 mcWarm = texture2D(mcLightmap, vec2((vMcLight.y * 15.0 + 0.5) / 16.0, 0.5 / 16.0)).rgb;',
          'reflectedLight.indirectDiffuse += diffuseColor.rgb * mcWarm * mcGlow;'
        ].join('\n')
      )
    }
  }
  mat.customProgramCacheKey = () => `mclight-${cinematic ? 'c' : 'v'}`
}

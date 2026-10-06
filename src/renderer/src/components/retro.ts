import { Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'

// The CRT TV look: a gently curved screen (always zoomed to fill the frame, never black corners), scanlines,
// an RGB aperture-grille mask and a hint of colour fringing. It runs either before the always-on-top layers
// are drawn (titles stay clean) or after them (titles get the CRT look too).

const crtChunk = /* glsl */ `
// Barrel curve that maps the corners onto the corners, so the curved screen still fills the frame.
vec2 crtWarp(vec2 uv, float curve) {
  vec2 c = uv * 2.0 - 1.0;
  float k = 0.18 * curve;
  c *= (1.0 + k * dot(c, c)) / (1.0 + 2.0 * k);
  return c * 0.5 + 0.5;
}

vec3 crt(sampler2D tex, vec2 uv, vec2 res, vec2 fragCoord, float amount, float curve) {
  vec2 w = crtWarp(uv, curve);
  float px = max(1.0, res.y / 720.0);
  vec2 fringe = vec2(0.7 * amount * px / res.x, 0.0);
  vec3 col = vec3(texture2D(tex, w + fringe).r, texture2D(tex, w).g, texture2D(tex, w - fringe).b);
  // Scanlines: about 270 lines on any export size, darkest between lines, brightest on them.
  float line = 0.5 + 0.5 * cos(w.y * 270.0 * 6.2831853);
  col *= 1.0 - amount * 0.38 * line;
  // Aperture grille: each column of pixels favours one phosphor colour.
  float column = mod(floor(fragCoord.x / px), 3.0);
  vec3 mask = column < 1.0 ? vec3(1.0, 0.72, 0.72) : column < 2.0 ? vec3(0.72, 1.0, 0.72) : vec3(0.72, 0.72, 1.0);
  col *= mix(vec3(1.0), mask, amount * 0.6);
  // Tube glow at the centre, gentle falloff toward the edges; brightness restored for the mask and lines.
  vec2 c = w * 2.0 - 1.0;
  col *= (1.0 - 0.18 * amount * dot(c, c)) * (1.0 + 0.32 * amount);
  return col;
}
`

const effectFragment = /* glsl */ `
uniform float amount;
uniform float curve;
${crtChunk}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(crt(inputBuffer, uv, resolution, gl_FragCoord.xy, amount, curve), inputColor.a);
}
`

/** CRT inside the effect chain: everything rendered before the always-on-top layers. */
export class CrtEffect extends Effect {
  constructor() {
    super('CrtEffect', effectFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['amount', new THREE.Uniform(0.6)],
        ['curve', new THREE.Uniform(0.5)]
      ])
    })
  }
  setLook(amount: number, curve: number): void {
    this.uniforms.get('amount')!.value = amount
    this.uniforms.get('curve')!.value = curve
  }
}

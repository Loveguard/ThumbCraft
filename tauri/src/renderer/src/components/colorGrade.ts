import { Effect } from 'postprocessing'
import * as THREE from 'three'

// A single colour-grading pass: exposure, white balance (temperature/tint), contrast, saturation and
// split toning (tinting shadows and highlights separately), the core of how films and thumbnails get a "look".
const fragment = /* glsl */ `
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform float temperature;
uniform float tint;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float split;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exp2(exposure);
  // White balance in linear light: warm = more red/less blue, tint = green <-> magenta.
  c *= vec3(1.0 + 0.45 * temperature, 1.0 + 0.08 * temperature - 0.16 * tint, 1.0 - 0.5 * temperature);
  c *= vec3(1.0 + 0.08 * tint, 1.0, 1.0 + 0.08 * tint);
  // Contrast, saturation and toning work best in a perceptual (gamma) space.
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = (g - 0.5) * (1.0 + contrast) + 0.5;
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, 1.0 + saturation);
  float sh = 1.0 - smoothstep(0.0, 0.55, l);
  float hi = smoothstep(0.45, 1.0, l);
  g += (shadowTint - 0.5) * sh * split + (highlightTint - 0.5) * hi * split;
  outputColor = vec4(pow(max(g, 0.0), vec3(2.2)), inputColor.a);
}
`

export interface ColorGradeOptions {
  exposure?: number
  contrast?: number
  saturation?: number
  temperature?: number
  tint?: number
  shadowTint?: string
  highlightTint?: string
  split?: number
}

export class ColorGradeEffect extends Effect {
  constructor(o: ColorGradeOptions = {}) {
    super('ColorGradeEffect', fragment, {
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(o.exposure ?? 0)],
        ['contrast', new THREE.Uniform(o.contrast ?? 0)],
        ['saturation', new THREE.Uniform(o.saturation ?? 0)],
        ['temperature', new THREE.Uniform(o.temperature ?? 0)],
        ['tint', new THREE.Uniform(o.tint ?? 0)],
        // Colours are authored in sRGB; mid-grey (#808080) means "no tint".
        ['shadowTint', new THREE.Uniform(new THREE.Color(o.shadowTint ?? '#808080').convertLinearToSRGB())],
        ['highlightTint', new THREE.Uniform(new THREE.Color(o.highlightTint ?? '#808080').convertLinearToSRGB())],
        ['split', new THREE.Uniform(o.split ?? 0)]
      ])
    })
  }

  /** Updates the grade in place (no shader rebuild, so dragging a slider stays smooth). */
  set(o: ColorGradeOptions): void {
    const u = (name: string): THREE.Uniform => this.uniforms.get(name)!
    u('exposure').value = o.exposure ?? 0
    u('contrast').value = o.contrast ?? 0
    u('saturation').value = o.saturation ?? 0
    u('temperature').value = o.temperature ?? 0
    u('tint').value = o.tint ?? 0
    ;(u('shadowTint').value as THREE.Color).set(o.shadowTint ?? '#808080').convertLinearToSRGB()
    ;(u('highlightTint').value as THREE.Color).set(o.highlightTint ?? '#808080').convertLinearToSRGB()
    u('split').value = o.split ?? 0
  }
}

import { Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'

// Depth of field with focus points. Each point is a spot on the screen; whatever surface is under it (a
// character, the tree behind them) sets a distance that stays sharp. Every pixel blurs by how far its depth is
// from the closest focus distance, so several subjects at different distances can all be in focus at once.
export const MAX_FOCUS_POINTS = 8

const fragment = /* glsl */ `
uniform vec2 focusUV[${MAX_FOCUS_POINTS}];
uniform int focusCount;
uniform float range;
uniform float maxBlur;

float viewDepth(vec2 uv) {
  return -getViewZ(readDepth(uv));
}

// The nearest surface in a small disc around a focus point, so a thin character isn't missed for the
// background just behind it.
float surfaceAt(vec2 p) {
  vec2 e = texelSize * max(1.0, resolution.y / 720.0) * 4.0;
  float d = viewDepth(p);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    d = min(d, viewDepth(p + vec2(cos(a), sin(a)) * e));
  }
  return d;
}

// 0 = sharp, 1 = fully blurred. The sharp band widens a little with distance, like a real lens.
float blurAmount(float d, float focus[${MAX_FOCUS_POINTS}]) {
  float amount = 1.0;
  for (int i = 0; i < ${MAX_FOCUS_POINTS}; i++) {
    if (i >= focusCount) break;
    float f = focus[i];
    float band = 0.5 * range + 0.03 * f;
    amount = min(amount, smoothstep(band, band + max(range, 0.2 * f), abs(d - f)));
  }
  return amount;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float focus[${MAX_FOCUS_POINTS}];
  for (int i = 0; i < ${MAX_FOCUS_POINTS}; i++) focus[i] = i < focusCount ? surfaceAt(focusUV[i]) : 1e9;

  float px = max(1.0, resolution.y / 720.0);
  float maxR = maxBlur * px;
  float radius = blurAmount(viewDepth(uv), focus) * maxR;
  if (radius < 0.5) {
    outputColor = inputColor;
    return;
  }
  // A golden-angle disc of samples. A sample only counts if its own blur reaches this pixel, so sharp
  // subjects never smear into the blurred background around them.
  vec3 sum = inputColor.rgb;
  float total = 1.0;
  for (int k = 0; k < 40; k++) {
    float t = (float(k) + 0.5) / 40.0;
    float r = sqrt(t) * radius;
    float a = float(k) * 2.39996;
    vec2 o = vec2(cos(a), sin(a)) * r * texelSize;
    float sampleBlur = blurAmount(viewDepth(uv + o), focus) * maxR;
    float w = clamp(sampleBlur - r + 1.0, 0.0, 1.0);
    sum += texture2D(inputBuffer, uv + o).rgb * w;
    total += w;
  }
  outputColor = vec4(sum / total, inputColor.a);
}
`

export class FocusBlurEffect extends Effect {
  constructor() {
    super('FocusBlurEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['focusUV', new THREE.Uniform(Array.from({ length: MAX_FOCUS_POINTS }, () => new THREE.Vector2(0.5, 0.5)))],
        ['focusCount', new THREE.Uniform(1)],
        ['range', new THREE.Uniform(4)],
        ['maxBlur', new THREE.Uniform(6)]
      ])
    })
  }

  /** Focus points in viewport fractions (x right, y down, 0…1), the sharp depth band and the blur size. */
  setFocus(points: { x: number; y: number }[], range: number, blur: number): void {
    const uv = this.uniforms.get('focusUV')!.value as THREE.Vector2[]
    const list = points.slice(0, MAX_FOCUS_POINTS)
    list.forEach((p, i) => uv[i].set(p.x, 1 - p.y))
    this.uniforms.get('focusCount')!.value = Math.max(1, list.length)
    this.uniforms.get('range')!.value = range
    this.uniforms.get('maxBlur')!.value = blur
  }
}

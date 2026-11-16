import { Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'

// Lens effects thumbnail makers usually fake by hand in an image editor.

const warpFragment = /* glsl */ `
uniform float amount;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv * 2.0 - 1.0;
  // Keep circles round on any aspect ratio.
  float aspect = resolution.x / resolution.y;
  vec2 a = vec2(c.x * aspect, c.y);
  float r2 = dot(a, a) / (aspect * aspect);
  // Pinching is gentler at full strength: past this the edges start to smear.
  float k = amount > 0.0 ? 0.35 * amount : 0.2 * amount;
  // Bulge (curved TV / fisheye) samples further out toward the edges and is scaled so the corners land on the
  // corners; pinch samples inward, so the edges stay filled either way. Never any black corners.
  float cornerR2 = (aspect * aspect + 1.0) / (aspect * aspect);
  vec2 w = k > 0.0 ? c * (1.0 + k * r2) / (1.0 + k * cornerR2) : c * (1.0 + k * r2);
  outputColor = texture2D(inputBuffer, w * 0.5 + 0.5);
}
`

/** Curves the image like a curved TV or fisheye (positive) or pinches it inward (negative), always filling the frame. */
export class LensWarpEffect extends Effect {
  constructor() {
    super('LensWarpEffect', warpFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['amount', new THREE.Uniform(0.5)]])
    })
  }
  setAmount(amount: number): void {
    this.uniforms.get('amount')!.value = amount
  }
}

const burstFragment = /* glsl */ `
uniform vec2 center;
uniform float amount;
uniform float clear;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 toCenter = center - uv;
  float aspect = resolution.x / resolution.y;
  float dist = length(vec2(toCenter.x * aspect, toCenter.y));
  // Sharp in the middle, streaking harder toward the edges, like a fast zoom toward the subject.
  float strength = amount * smoothstep(clear * 0.6, clear * 0.6 + 0.45, dist);
  if (strength <= 0.001) {
    outputColor = inputColor;
    return;
  }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float t = float(i) / 31.0;
    float w = 1.0 - 0.5 * t;
    sum += texture2D(inputBuffer, uv + toCenter * t * strength * 0.35).rgb * w;
    total += w;
  }
  outputColor = vec4(sum / total, inputColor.a);
}
`

/** A radial zoom blur (speed burst) toward a point, with a clear area around it. */
export class SpeedBurstEffect extends Effect {
  constructor() {
    super('SpeedBurstEffect', burstFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['amount', new THREE.Uniform(0.5)],
        ['clear', new THREE.Uniform(0.35)]
      ])
    })
  }
  /** Center in viewport fractions (x right, y down). */
  setBurst(x: number, y: number, amount: number, clear: number): void {
    ;(this.uniforms.get('center')!.value as THREE.Vector2).set(x, 1 - y)
    this.uniforms.get('amount')!.value = amount
    this.uniforms.get('clear')!.value = clear
  }
}

const streakFragment = /* glsl */ `
uniform float amount;
uniform float threshold;
uniform vec3 tint;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Long horizontal streaks from bright spots, like an anamorphic film lens.
  // Only light brighter than white (the sun, torches, glowing blocks) makes a streak.
  float px = max(1.0, resolution.y / 720.0);
  vec3 streak = vec3(0.0);
  for (int i = 1; i <= 48; i++) {
    float d = float(i) * 6.0 * px;
    float fall = exp(-float(i) * 0.07);
    for (int s = -1; s <= 1; s += 2) {
      vec3 c = texture2D(inputBuffer, uv + vec2(float(s) * d * texelSize.x, 0.0)).rgb;
      float bright = max(c.r, max(c.g, c.b));
      streak += smoothstep(threshold, threshold * 1.6, bright) * fall * vec3(bright);
    }
  }
  outputColor = vec4(inputColor.rgb + streak * tint * amount * 0.09, inputColor.a);
}
`

/** Anamorphic lens streaks: horizontal light lines from the brightest spots. */
export class AnamorphicEffect extends Effect {
  constructor() {
    super('AnamorphicEffect', streakFragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['amount', new THREE.Uniform(0.6)],
        ['threshold', new THREE.Uniform(1.2)],
        ['tint', new THREE.Uniform(new THREE.Color('#7fb8ff'))]
      ])
    })
  }
  setStreaks(amount: number, threshold: number, color: string): void {
    this.uniforms.get('amount')!.value = amount
    this.uniforms.get('threshold')!.value = threshold
    ;(this.uniforms.get('tint')!.value as THREE.Color).set(color)
  }
}

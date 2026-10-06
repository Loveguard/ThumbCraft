import { wrapEffect } from '@react-three/postprocessing'
import { Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'

// The hand-painted look of Minecraft's promotional art: a Kuwahara filter turns pixels into brush strokes
// while keeping edges crisp, light is gently banded like painted shading, and a soft ink line follows edges.
const fragment = /* glsl */ `
uniform float strength;
uniform float ink;

// Mean and variance of one quadrant of the brush around uv.
void quadrant(vec2 uv, vec2 dir, vec2 step, out vec3 mean, out float variance) {
  vec3 sum = vec3(0.0);
  vec3 sq = vec3(0.0);
  for (int y = 0; y <= 3; y++)
    for (int x = 0; x <= 3; x++) {
      vec3 c = texture2D(inputBuffer, uv + vec2(float(x), float(y)) * dir * step).rgb;
      sum += c;
      sq += c * c;
    }
  mean = sum / 16.0;
  vec3 v = sq / 16.0 - mean * mean;
  variance = v.r + v.g + v.b;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Brush size follows the image height, so exports at 4K look like the preview.
  vec2 step = texelSize * max(1.0, resolution.y / 720.0) * strength;
  vec3 m0, m1, m2, m3;
  float v0, v1, v2, v3;
  quadrant(uv, vec2(-1.0, -1.0), step, m0, v0);
  quadrant(uv, vec2(1.0, -1.0), step, m1, v1);
  quadrant(uv, vec2(-1.0, 1.0), step, m2, v2);
  quadrant(uv, vec2(1.0, 1.0), step, m3, v3);
  // Kuwahara: keep the calmest quadrant's colour, which smooths texture but never blurs across an edge.
  vec3 c = m0;
  float best = v0;
  if (v1 < best) { best = v1; c = m1; }
  if (v2 < best) { best = v2; c = m2; }
  if (v3 < best) { best = v3; c = m3; }

  // Painted shading: pull brightness gently toward a few bands.
  float l = luma(c);
  float banded = (floor(l * 6.0) + smoothstep(0.3, 0.7, fract(l * 6.0))) / 6.0;
  c *= mix(1.0, banded / max(l, 1e-3), 0.35);

  // A soft ink line where brightness changes sharply.
  vec2 e = texelSize * max(1.0, resolution.y / 720.0) * 1.5;
  float gx = luma(texture2D(inputBuffer, uv + vec2(e.x, 0.0)).rgb) - luma(texture2D(inputBuffer, uv - vec2(e.x, 0.0)).rgb);
  float gy = luma(texture2D(inputBuffer, uv + vec2(0.0, e.y)).rgb) - luma(texture2D(inputBuffer, uv - vec2(0.0, e.y)).rgb);
  float edge = smoothstep(0.08, 0.3, length(vec2(gx, gy)));
  c *= 1.0 - edge * ink;

  outputColor = vec4(c, inputColor.a);
}
`

export interface PainterlyOptions {
  /** Brush size (1 = a 4-pixel brush at 720p). */
  strength?: number
  /** How dark the edge lines are (0…1). */
  ink?: number
}

export class PainterlyEffect extends Effect {
  constructor(o: PainterlyOptions = {}) {
    super('PainterlyEffect', fragment, {
      // Samples neighbouring pixels, so it needs a pass of its own.
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(o.strength ?? 1.3)],
        ['ink', new THREE.Uniform(o.ink ?? 0.5)]
      ])
    })
  }
}

export const Painterly = wrapEffect(PainterlyEffect)

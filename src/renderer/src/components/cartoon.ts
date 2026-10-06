import { wrapEffect } from '@react-three/postprocessing'
import { Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'

// The cel-shaded look of Minecraft's key art: textures smoothed into clean flat shapes (a small Kuwahara
// filter keeps every edge crisp), colours pushed bright and saturated, light gently banded like cel paint,
// and a thin dark line where an object stands out against what's behind it.
const fragment = /* glsl */ `
uniform float flatten;
uniform float line;
uniform float brighten;
uniform float vivid;

// Mean and variance of one quadrant of the brush around uv.
void quadrant(vec2 uv, vec2 dir, vec2 brush, out vec3 mean, out float variance) {
  vec3 sum = vec3(0.0);
  vec3 sq = vec3(0.0);
  for (int y = 0; y <= 2; y++)
    for (int x = 0; x <= 2; x++) {
      vec3 c = texture2D(inputBuffer, uv + vec2(float(x), float(y)) * dir * brush).rgb;
      sum += c;
      sq += c * c;
    }
  mean = sum / 9.0;
  vec3 v = sq / 9.0 - mean * mean;
  variance = v.r + v.g + v.b;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float viewDepth(vec2 uv) {
  return -getViewZ(readDepth(uv));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Sizes follow the image height, so a 4K export looks like the preview.
  float px = max(1.0, resolution.y / 720.0);
  vec2 brush = texelSize * px * flatten;
  vec3 m0, m1, m2, m3;
  float v0, v1, v2, v3;
  quadrant(uv, vec2(-1.0, -1.0), brush, m0, v0);
  quadrant(uv, vec2(1.0, -1.0), brush, m1, v1);
  quadrant(uv, vec2(-1.0, 1.0), brush, m2, v2);
  quadrant(uv, vec2(1.0, 1.0), brush, m3, v3);
  vec3 c = m0;
  float best = v0;
  if (v1 < best) { best = v1; c = m1; }
  if (v2 < best) { best = v2; c = m2; }
  if (v3 < best) { best = v3; c = m3; }
  // Keep a little of the original pixel grain, as the key art does.
  c = mix(c, inputColor.rgb, 0.15);

  // High-key colour: midtones and shade lifted (key art never goes muddy), then colours pushed vivid.
  float l0 = luma(c);
  float lifted = 1.0 - pow(1.0 - clamp(l0, 0.0, 1.0), 1.7);
  c *= mix(1.0, lifted / max(l0, 1e-3), brighten);
  // Vibrance, not plain saturation: dull colours (grass, sky haze) gain the most, colours that are
  // already strong (skin, a clear sky) stay natural instead of turning orange or neon.
  float l1 = luma(c);
  float hi = max(c.r, max(c.g, c.b));
  float sat = (hi - min(c.r, min(c.g, c.b))) / max(hi, 1e-3);
  c = max(mix(vec3(l1), c, 1.0 + vivid * (1.0 - sat) * (1.0 - sat)), 0.0);
  // A soft shoulder so bright colours roll off instead of clipping.
  vec3 over = max(c - 0.8, 0.0);
  c = min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));

  // Cel paint: brightness drawn gently toward a few flat steps.
  float l = luma(c);
  float steps = 5.0;
  float banded = (floor(l * steps) + smoothstep(0.35, 0.65, fract(l * steps))) / steps;
  c *= mix(1.0, banded / max(l, 1e-3), 0.3);

  // Outline where depth jumps (an object in front of a farther one), thin and tinted dark, not black.
  float d = viewDepth(uv);
  vec2 e = texelSize * px;
  float dl = viewDepth(uv - vec2(e.x, 0.0));
  float dr = viewDepth(uv + vec2(e.x, 0.0));
  float du = viewDepth(uv + vec2(0.0, e.y));
  float dd = viewDepth(uv - vec2(0.0, e.y));
  float jump = max(max(dl, dr), max(du, dd)) - d;
  float edge = smoothstep(0.06, 0.14, jump / max(d, 0.5)) * step(d, 400.0);
  c = mix(c, c * vec3(0.22, 0.24, 0.32), edge * line);

  outputColor = vec4(c, inputColor.a);
}
`

export interface CartoonOptions {
  /** Texture smoothing (1 = a 3-pixel brush at 720p). */
  flatten?: number
  /** Outline strength (0…1). */
  line?: number
  /** How far midtones and shade are lifted (0…1). */
  brighten?: number
  /** Extra saturation. */
  vivid?: number
}

export class CartoonEffect extends Effect {
  constructor(o: CartoonOptions = {}) {
    super('CartoonEffect', fragment, {
      // Samples neighbouring pixels and the depth buffer, so it needs a pass of its own.
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['flatten', new THREE.Uniform(o.flatten ?? 1.5)],
        ['line', new THREE.Uniform(o.line ?? 0.85)],
        ['brighten', new THREE.Uniform(o.brighten ?? 0.75)],
        ['vivid', new THREE.Uniform(o.vivid ?? 0.9)]
      ])
    })
  }
}

export const Cartoon = wrapEffect(CartoonEffect)

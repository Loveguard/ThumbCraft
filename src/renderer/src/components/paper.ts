import { Effect, EffectAttribute, Pass } from 'postprocessing'
import * as THREE from 'three'
import { HELPER_LAYER } from '../overlay'

// The film-print looks, each switched on separately (one pass draws whichever are on):
// - Paper cutout: the players (and optionally mobs) look torn out of a printed photo, sitting on the scene with a
//   ragged white paper border and a soft drop shadow.
// - Film halation: a red-orange glow bleeding around bright highlights, like film without an anti-halation layer.
// - Fujifilm colour: teal-leaning greens, lifted cool shadows, warm soft highlights.
// - Light leak: warm orange-red light fogging in from one edge of the frame, like a camera back opened too soon.
// - Paper folds: the picture printed on paper that has been folded and handled (creases, crumpling, fibre).
//
// Each frame, before the effect runs: the subjects are drawn alone into a mask (with their depth, so a tree in
// front of a player still covers them), the mask is turned into a distance field at a fixed 720p-scale size (so
// the border looks the same in the viewport and in a 4K export), and the bright parts of the frame are blurred
// for the halation.

/** A layer nothing else uses: the subjects join it while the mask is drawn. */
const MASK_LAYER = 7
/** Distances are measured up to this far from a subject, in 720p pixels. */
const REACH = 64
/** The distance field is built at half of 720p. */
const FIELD_HEIGHT = 360

const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

/** One full-screen shader step into a render target. */
class ShaderStep extends Pass {
  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    super('PaperStep')
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false
    })
  }
  get uniforms(): Record<string, THREE.IUniform> {
    return (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms
  }
  render(renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget | null, output: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(output)
    renderer.render(this.scene, this.camera)
  }
}

// Which pixels of the field show a subject: drawn there, and not hidden behind the scene.
const visibleFragment = /* glsl */ `
#include <packing>
uniform sampler2D mask;
uniform sampler2D maskDepth;
uniform sampler2D sceneDepth;
uniform bool hasSceneDepth;
uniform bool rgbaDepth;
varying vec2 vUv;
void main() {
  float m = texture2D(mask, vUv).a;
  float seen = 1.0;
  if (hasSceneDepth) {
    vec4 s = texture2D(sceneDepth, vUv);
    float sd = rgbaDepth ? unpackRGBAToDepth(s) : s.r;
    seen = step(texture2D(maskDepth, vUv).r, sd + 0.0002);
  }
  gl_FragColor = vec4(step(0.5, m) * seen, 0.0, 0.0, 1.0);
}
`

// Exact distances in two sweeps: along each row to the nearest subject pixel, then down each column.
const rowFragment = /* glsl */ `
uniform sampler2D field;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  float best = ${REACH / 2 + 1}.0;
  for (int i = -${REACH / 2}; i <= ${REACH / 2}; i++) {
    if (texture2D(field, vUv + vec2(float(i) * texel.x, 0.0)).r > 0.5) best = min(best, abs(float(i)));
  }
  gl_FragColor = vec4(best, 0.0, 0.0, 1.0);
}
`
const columnFragment = /* glsl */ `
uniform sampler2D rows;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  float best = ${REACH / 2 + 1}.0;
  for (int i = -${REACH / 2}; i <= ${REACH / 2}; i++) {
    float dx = texture2D(rows, vUv + vec2(0.0, float(i) * texel.y)).r;
    best = min(best, length(vec2(dx, float(i))));
  }
  // In 720p pixels.
  gl_FragColor = vec4(best * 2.0, 0.0, 0.0, 1.0);
}
`

// The highlights that bleed red-orange into the film's backing, before the blur spreads them.
const brightFragment = /* glsl */ `
uniform sampler2D image;
varying vec2 vUv;
void main() {
  // Capped, and invalid values (NaN, which a frame can briefly hold while the scene loads) dropped: the blur
  // would spread a single one over the whole frame.
  vec3 c = texture2D(image, vUv).rgb;
  if (!(c.r >= 0.0 && c.r < 1e4 && c.g >= 0.0 && c.g < 1e4 && c.b >= 0.0 && c.b < 1e4)) c = vec3(0.0);
  c = min(c, vec3(4.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(0.85, 1.8, l), 1.0);
}
`

// A wide, soft blur of the highlights, one direction at a time.
const blurFragment = /* glsl */ `
uniform sampler2D image;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -12; i <= 12; i++) {
    float w = exp(-float(i * i) / 50.0);
    sum += texture2D(image, vUv + step * float(i)).rgb * w;
    total += w;
  }
  gl_FragColor = vec4(sum / total, 1.0);
}
`

const fragment = /* glsl */ `
uniform sampler2D visibleTex;
uniform sampler2D distTex;
uniform sampler2D glowTex;
uniform bool cutout;
uniform float edge;
uniform float rough;
uniform float shadow;
uniform float folds;
uniform float halation;
uniform float fuji;
uniform float leak;
uniform float leakX;
uniform float seed;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + seed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.9375;
}

bool isSubject(vec2 uv) {
  return texture2D(visibleTex, uv).r > 0.5;
}

// How far the torn border reaches here (720p pixels): a wobbly outline with small torn teeth along it.
float borderWidth(vec2 p) {
  float wobble = fbm(p / 20.0) - 0.5;
  // Torn teeth: mostly small nicks, now and then a longer tooth sticking out.
  float teeth = pow(vnoise(p / 1.8), 2.5) * 7.0 - 1.5 + (vnoise(p / 5.0) - 0.5) * 3.0;
  return max(1.5, edge * (1.0 + 1.7 * rough * wobble) + rough * teeth);
}

// A fold across the print: a thin lit ridge, a dark valley beside it, one side a touch darker.
float crease(vec2 p, vec2 origin, vec2 dir) {
  vec2 n = normalize(vec2(-dir.y, dir.x));
  float s = dot(p - origin, n);
  return 0.18 * exp(-pow((s - 1.6) / 1.8, 2.0)) - 0.22 * exp(-pow((s + 1.0) / 1.4, 2.0)) + 0.06 * tanh(s / 45.0);
}

vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

// Fujifilm-style colour: greens lean teal, lifted cool-green shadows, warm soft highlights, a gentle S-curve.
vec3 fujiColour(vec3 lin) {
  vec3 c = clamp(toSrgb(lin), 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float green = clamp(c.g - max(c.r, c.b), 0.0, 1.0);
  c += green * vec3(-0.12, 0.0, 0.22);
  c = mix(vec3(l), c, 0.9);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
  c = 0.035 + c * 0.94;
  c += (1.0 - l) * (1.0 - l) * vec3(-0.012, 0.012, 0.018);
  c += l * l * vec3(0.03, 0.012, -0.02);
  return toLinear(c);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // A blown-out sky can reach infinity in the half-float frame, and infinity can't be painted over (mixing it
  // with the paper gives NaN): cap it first. Anything not a number becomes plain white.
  vec3 col = min(inputColor.rgb, vec3(64.0));
  if (!(col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0)) col = vec3(1.0);
  float aspect = resolution.x / resolution.y;
  vec2 p = uv * vec2(aspect, 1.0) * 720.0;

  if (cutout && edge > 0.0) {
    bool inside = isSubject(uv);
    if (!inside) {
      float d = texture2D(distTex, uv).r;
      float w = borderWidth(p);
      // The drop shadow: the cutout's shape (border included), shifted down-right and softened, plus a faint
      // contact shadow all round so the border reads even on a pale sky.
      vec2 shift = vec2(4.0 + 8.0 * shadow, -(5.0 + 10.0 * shadow)) / vec2(720.0 * aspect, 720.0);
      float ds = texture2D(distTex, uv - shift).r;
      float sh = 1.0 - smoothstep(edge, edge + 6.0 + 10.0 * shadow, ds);
      float contact = 1.0 - smoothstep(w, w + 4.0, d);
      col *= 1.0 - shadow * (0.75 * sh + 0.35 * contact);
      // The paper border, with loose white fibres along the torn edge.
      float paper = 1.0 - smoothstep(w - 0.7, w + 0.7, d);
      // Fluffy torn fibres reach a little past the edge.
      float fuzz = (1.0 - smoothstep(w, w + 2.5, d)) * step(0.62, vnoise(p * vec2(1.4, 0.5))) * rough;
      paper = max(paper, fuzz * 0.7);
      float rim = smoothstep(w - 3.5, w, d);
      // The printed face of the paper is a warm off-white; the torn edge shows the brighter paper core.
      vec3 sheet = vec3(0.8, 0.77, 0.7) * (0.93 + 0.1 * fbm(p / 2.2));
      sheet = mix(sheet, vec3(0.97, 0.96, 0.93), rim);
      col = mix(col, sheet, paper);
    }
  }

  // The camera: highlights bleed red-orange (halation), then Fuji colour.
  vec3 glow = clamp(texture2D(glowTex, uv).rgb, 0.0, 4.0);
  vec3 hal = (glow * vec3(1.0, 0.3, 0.12) * 0.7 + glow * 0.06) * halation;
  col += hal * (1.0 - clamp(col, 0.0, 1.0));
  col = mix(col, fujiColour(col), fuji);

  // The light leak: a warm, uneven blob pouring in from above the frame, hottest (yellow-orange) at its core
  // and red where it fades, with a faint wash over the whole frame.
  if (leak > 0.0) {
    vec2 q = (p - vec2(leakX * aspect * 720.0, 800.0)) / vec2(300.0, 560.0);
    float k = exp(-dot(q, q) * 1.4) * (0.55 + 0.9 * fbm(p / 170.0 + 7.0));
    k = clamp(k, 0.0, 1.4);
    vec3 tint = mix(vec3(0.9, 0.08, 0.02), vec3(1.0, 0.55, 0.16), smoothstep(0.35, 1.0, k));
    vec3 light = (tint * k + vec3(0.03, 0.012, 0.0)) * leak;
    col += light * (1.0 - clamp(col, 0.0, 1.0) * 0.6);
  }

  // The print: folds, crumpled-paper shading and paper fibre.
  if (folds > 0.0) {
    vec2 mid = vec2(aspect * 360.0, 360.0);
    float shade = crease(p, mid + vec2(24.0, 0.0), normalize(vec2(0.04, 1.0)));
    shade += crease(p, mid + vec2(0.0, 40.0), normalize(vec2(1.0, -0.03)));
    shade += 0.7 * crease(p, vec2(aspect * 720.0 - 150.0, 720.0), normalize(vec2(1.0, 0.72)));
    float e = 3.0;
    float n = fbm(p / 110.0);
    vec2 grad = vec2(fbm((p + vec2(e, 0.0)) / 110.0) - n, fbm((p + vec2(0.0, e)) / 110.0) - n) / e * 110.0;
    shade += dot(grad, vec2(-0.6, 0.8)) * 0.12;
    float fibre = fbm(p * vec2(0.9, 0.35)) - 0.5;
    col *= max(0.0, 1.0 + folds * (shade * 1.6 + fibre * 0.12));
    // Light catching the raised side of each fold shows even over dark parts of the picture.
    col += folds * (max(shade, 0.0) * 0.1 + 0.012);
    col = mix(col, col * vec3(1.03, 1.0, 0.93) + vec3(0.012, 0.01, 0.006), folds * 0.5);
  }

  outputColor = vec4(col, inputColor.a);
}
`

export interface PaperLook {
  cutout: boolean
  edge: number
  rough: number
  shadow: number
  folds: number
  halation: number
  fuji: number
  leak: number
  leakX: number
}

export class PaperEffect extends Effect {
  private mask = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) })
  /** Full size: which pixels show a subject (the distance field samples it at its own, smaller size). */
  private visible = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false
  })
  private rows = fieldTarget(THREE.NearestFilter)
  private distance = fieldTarget(THREE.LinearFilter)
  private bright = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  private glow = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  private visibleStep = new ShaderStep(visibleFragment, {
    mask: { value: this.mask.texture },
    maskDepth: { value: this.mask.depthTexture },
    sceneDepth: { value: null },
    hasSceneDepth: { value: false },
    rgbaDepth: { value: false }
  })
  private rowStep = new ShaderStep(rowFragment, {
    field: { value: this.visible.texture },
    texel: { value: new THREE.Vector2() }
  })
  private columnStep = new ShaderStep(columnFragment, {
    rows: { value: this.rows.texture },
    texel: { value: new THREE.Vector2() }
  })
  private brightStep = new ShaderStep(brightFragment, { image: { value: null } })
  // The highlights go into `glow`, then blur across into `bright` and back down into `glow`, twice over.
  private acrossStep = new ShaderStep(blurFragment, {
    image: { value: this.glow.texture },
    step: { value: new THREE.Vector2() }
  })
  private downStep = new ShaderStep(blurFragment, {
    image: { value: this.bright.texture },
    step: { value: new THREE.Vector2() }
  })
  /** Objects currently on the mask layer, so ones that stop being subjects can be taken off it. */
  private tagged = new Set<THREE.Object3D>()
  private look: PaperLook = {
    cutout: true,
    edge: 12,
    rough: 0.6,
    shadow: 0.5,
    folds: 0.5,
    halation: 0.5,
    fuji: 0.6,
    leak: 0,
    leakX: 0.15
  }

  constructor(
    private world: THREE.Scene,
    private view: THREE.Camera,
    /** The roots of the objects to cut out, looked up fresh every frame. */
    private subjects: () => THREE.Object3D[]
  ) {
    super('PaperEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['visibleTex', new THREE.Uniform(null)],
        ['distTex', new THREE.Uniform(null)],
        ['glowTex', new THREE.Uniform(null)],
        ['cutout', new THREE.Uniform(true)],
        ['edge', new THREE.Uniform(9)],
        ['rough', new THREE.Uniform(0.6)],
        ['shadow', new THREE.Uniform(0.5)],
        ['folds', new THREE.Uniform(0.5)],
        ['halation', new THREE.Uniform(0.5)],
        ['fuji', new THREE.Uniform(0.6)],
        ['leak', new THREE.Uniform(0)],
        ['leakX', new THREE.Uniform(0.15)],
        ['seed', new THREE.Uniform(0.37)]
      ])
    })
    this.uniforms.get('visibleTex')!.value = this.visible.texture
    this.uniforms.get('distTex')!.value = this.distance.texture
    this.uniforms.get('glowTex')!.value = this.glow.texture
  }

  setLook(look: PaperLook): void {
    this.look = look
    for (const [k, v] of Object.entries(look)) this.uniforms.get(k)!.value = v
  }

  setDepthTexture(
    depthTexture: THREE.Texture,
    depthPacking: THREE.DepthPackingStrategies = THREE.BasicDepthPacking
  ): void {
    const u = this.visibleStep.uniforms
    u.sceneDepth.value = depthTexture
    u.hasSceneDepth.value = !!depthTexture
    u.rgbaDepth.value = depthPacking === THREE.RGBADepthPacking
  }

  setSize(width: number, height: number): void {
    this.mask.setSize(width, height)
    this.visible.setSize(width, height)
    const fw = Math.max(1, Math.round((FIELD_HEIGHT * width) / Math.max(1, height)))
    for (const t of [this.rows, this.distance]) t.setSize(fw, FIELD_HEIGHT)
    const texel = new THREE.Vector2(1 / fw, 1 / FIELD_HEIGHT)
    this.rowStep.uniforms.texel.value = texel
    this.columnStep.uniforms.texel.value = texel
    const qw = Math.max(1, Math.round(width / 4))
    const qh = Math.max(1, Math.round(height / 4))
    this.bright.setSize(qw, qh)
    this.glow.setSize(qw, qh)
    this.acrossStep.uniforms.step.value.set(2 / qw, 0)
    this.downStep.uniforms.step.value.set(0, 2 / qh)
  }

  update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    if (this.look.halation > 0) {
      this.brightStep.uniforms.image.value = inputBuffer.texture
      this.brightStep.render(renderer, null, this.glow)
      for (let i = 0; i < 2; i++) {
        this.acrossStep.render(renderer, null, this.bright)
        this.downStep.render(renderer, null, this.glow)
      }
    }
    if (this.look.cutout && this.look.edge > 0) {
      this.drawMask(renderer)
      this.visibleStep.render(renderer, null, this.visible)
      this.rowStep.render(renderer, null, this.rows)
      this.columnStep.render(renderer, null, this.distance)
    }
  }

  /** The subjects alone, with their depth, into the mask (alpha = subject). */
  private drawMask(renderer: THREE.WebGLRenderer): void {
    const now = new Set<THREE.Object3D>()
    for (const root of this.subjects())
      root.traverse((o) => {
        if (o.layers.isEnabled(HELPER_LAYER) || o.userData.helper) return
        o.layers.enable(MASK_LAYER)
        now.add(o)
      })
    for (const o of this.tagged) if (!now.has(o)) o.layers.disable(MASK_LAYER)
    this.tagged = now

    const mask = this.view.layers.mask
    const background = this.world.background
    const autoClear = renderer.autoClear
    const shadows = renderer.shadowMap.autoUpdate
    const clearColor = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    this.view.layers.set(MASK_LAYER)
    this.world.background = null
    renderer.shadowMap.autoUpdate = false
    renderer.autoClear = false
    renderer.setRenderTarget(this.mask)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    if (now.size) renderer.render(this.world, this.view)
    renderer.setClearColor(clearColor, clearAlpha)
    renderer.autoClear = autoClear
    renderer.shadowMap.autoUpdate = shadows
    this.world.background = background
    this.view.layers.mask = mask
  }

  dispose(): void {
    for (const o of this.tagged) o.layers.disable(MASK_LAYER)
    for (const t of [this.mask, this.visible, this.rows, this.distance, this.bright, this.glow]) t.dispose()
    this.mask.depthTexture?.dispose()
    for (const s of [this.visibleStep, this.rowStep, this.columnStep, this.brightStep, this.acrossStep, this.downStep])
      s.dispose()
    super.dispose()
  }
}

function fieldTarget(filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: filter,
    magFilter: filter,
    depthBuffer: false
  })
}

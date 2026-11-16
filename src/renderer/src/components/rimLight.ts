import { Effect, EffectAttribute, Pass } from 'postprocessing'
import * as THREE from 'three'
import { HELPER_LAYER } from '../overlay'
import type { RimLight, SceneObject } from '../store'

// Rim light: a bright edge painted on one object from the side a light would come from, as in the key art of games
// and the rim lights of a Photoshop or Blender thumbnail. It is a picture effect, not a lamp in the scene: nothing
// else gets brighter and no shadows change, so it can be as strong as a thumbnail needs.
//
// Each frame, for each object with a rim light: the object is drawn alone (with its depth) into a mask. Its depth
// gives each pixel the way its surface faces, and the light, placed behind the object off to one side, lights the
// faces turned toward it (so a blocky character catches it face by face, as under a real back light). On top, a hot
// line runs along the outline that faces the light, fading inward. The light brightens and tints the surface rather
// than covering it, and a blurred copy spills a soft glow past the outline.

/** A layer nothing else uses (the paper cutout has 7): one object at a time joins it while its mask is drawn. */
const MASK_LAYER = 6
/** Objects with a rim light at most; more would cost a mask each frame. */
export const MAX_RIMS = 12

export const DEFAULT_RIM: RimLight = {
  color: '#ffe9c4',
  intensity: 2.4,
  angle: 40,
  width: 16,
  wrap: 0.3
}

/** Objects a rim light can go on: the solid 3D things in the scene. */
export const canRim = (o: SceneObject): boolean =>
  o.kind === 'player' ||
  o.kind === 'mob' ||
  o.kind === 'model' ||
  o.kind === 'pixelText' ||
  (o.kind === 'terrain' && !o.ground)

const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

const rimFragment = /* glsl */ `
#include <packing>
uniform sampler2D mask;
uniform sampler2D maskDepth;
uniform sampler2D sceneDepth;
uniform bool hasSceneDepth;
uniform bool rgbaDepth;
uniform bool ortho;
uniform float near;
uniform float far;
uniform mat4 projInv;
uniform vec3 color;
uniform float intensity;
uniform vec2 dir;
uniform float width;
uniform float wrap;
uniform vec2 texel;
varying vec2 vUv;

float distanceOf(float d) {
  return ortho ? -orthographicDepthToViewZ(d, near, far) : -perspectiveDepthToViewZ(d, near, far);
}

// Whether the object is at uv and about as near as z0 (a part of it well behind counts as an edge).
bool onObject(vec2 uv, float z0) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return false;
  if (texture2D(mask, uv).a < 0.5) return false;
  float z = distanceOf(texture2D(maskDepth, uv).r);
  return z < z0 + max(0.12, z0 * 0.015);
}

vec3 viewPos(vec2 uv) {
  float d = texture2D(maskDepth, uv).r;
  vec4 p = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

// The surface's facing, from the object's own depth: of the two neighbours on each axis, the one on the same face.
vec3 surfaceNormal(vec2 uv, vec3 p) {
  vec3 r = viewPos(uv + vec2(texel.x, 0.0)) - p;
  vec3 l = p - viewPos(uv - vec2(texel.x, 0.0));
  vec3 u = viewPos(uv + vec2(0.0, texel.y)) - p;
  vec3 d = p - viewPos(uv - vec2(0.0, texel.y));
  vec3 dx = abs(r.z) < abs(l.z) ? r : l;
  vec3 dy = abs(u.z) < abs(d.z) ? u : d;
  return normalize(cross(dx, dy));
}

void main() {
  if (texture2D(mask, vUv).a < 0.5) discard;
  float d0 = texture2D(maskDepth, vUv).r;
  if (hasSceneDepth) {
    vec4 s = texture2D(sceneDepth, vUv);
    float sd = rgbaDepth ? unpackRGBAToDepth(s) : s.r;
    // Hidden behind something else in the scene.
    if (d0 > sd + 0.0002) discard;
  }
  float z0 = distanceOf(d0);

  // The light sits behind the object, off to the side the dial points; wrapping brings it round toward the camera.
  vec3 light = normalize(vec3(dir, mix(-1.1, 0.35, wrap)));
  vec3 n = surfaceNormal(vUv, viewPos(vUv));
  // Faces turned toward the light catch it, fading softly as they turn away (blocks show it face by face).
  float shape = smoothstep(-0.05, 0.75, dot(n, light));

  // The hot line along the outline that faces the light, fading in over the width.
  vec2 outward = vec2(0.0);
  float nearest = 1.0;
  for (int j = 0; j < 16; j++) {
    float a = float(j) * 0.39269908;
    vec2 way = vec2(cos(a), sin(a));
    vec2 stepUv = way * texel * width / 10.0;
    for (int i = 1; i <= 10; i++) {
      if (!onObject(vUv + stepUv * float(i), z0)) {
        float d = float(i - 1) / 10.0;
        nearest = min(nearest, d);
        outward += way * (1.0 - d);
        break;
      }
    }
  }
  float facing = dot(normalize(outward + 1e-5), dir);
  // Brightest where the outline faces the light squarely, fading round the sides (wrap carries it further).
  float edgeAt = cos(3.14159265 * (0.28 + 0.6 * wrap));
  float toward = smoothstep(edgeAt - 0.3, 1.0, facing);
  float edge = nearest < 1.0 ? toward * toward * exp(-3.5 * nearest) : 0.0;

  float lit = edge * (0.8 + 0.6 * shape) + 0.45 * shape;
  if (lit <= 0.001) discard;
  gl_FragColor = vec4(color * intensity * lit, 1.0);
}
`

// Soft spill: the rim light blurred, so it blooms past the outline like real light instead of stopping at it.
const blurFragment = /* glsl */ `
uniform sampler2D image;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(image, vUv).rgb * 0.2270;
  c += (texture2D(image, vUv + step * 1.3846).rgb + texture2D(image, vUv - step * 1.3846).rgb) * 0.3162;
  c += (texture2D(image, vUv + step * 3.2308).rgb + texture2D(image, vUv - step * 3.2308).rgb) * 0.0703;
  gl_FragColor = vec4(c, 1.0);
}
`

// The light lands on the surface: it brightens and tints what's there (so the skin's texture shows through), with a
// little added on top for the hot core, and the blurred spill glowing around it.
const addFragment = /* glsl */ `
uniform sampler2D rimTex;
uniform sampler2D glowTex;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 rim = texture2D(rimTex, uv).rgb;
  vec3 glow = texture2D(glowTex, uv).rgb;
  vec3 base = inputColor.rgb;
  vec3 c = base + rim * (0.3 + 1.3 * base) + glow * 0.7;
  outputColor = vec4(c, inputColor.a);
}
`

/** One full-screen shader step into a render target (added onto what's there when `add`). */
class ShaderStep extends Pass {
  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, add = false) {
    super('RimStep')
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: add ? THREE.AdditiveBlending : THREE.NoBlending,
      transparent: add
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

export interface RimSubject {
  root: THREE.Object3D
  rim: RimLight
}

/** The screen direction (y up) a rim light comes from: 0° from the right, 90° from above. */
export function rimDirection(angle: number): [number, number] {
  const a = THREE.MathUtils.degToRad(angle)
  return [Math.cos(a), Math.sin(a)]
}

export class RimLightEffect extends Effect {
  private mask = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) })
  private light = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  /** The spill, at a quarter size: blurred across into `spare`, then back down into `glow`, twice. */
  private glow = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  private spare = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  private step = new ShaderStep(
    rimFragment,
    {
      mask: { value: null },
      maskDepth: { value: null },
      sceneDepth: { value: null },
      hasSceneDepth: { value: false },
      rgbaDepth: { value: false },
      ortho: { value: false },
      near: { value: 0.1 },
      far: { value: 1000 },
      projInv: { value: new THREE.Matrix4() },
      color: { value: new THREE.Color() },
      intensity: { value: 1 },
      dir: { value: new THREE.Vector2(1, 0) },
      width: { value: 7 },
      wrap: { value: 0.3 },
      texel: { value: new THREE.Vector2() }
    },
    true
  )
  private downsample = new ShaderStep(blurFragment, { image: { value: null }, step: { value: new THREE.Vector2() } })
  private across = new ShaderStep(blurFragment, { image: { value: null }, step: { value: new THREE.Vector2() } })
  private down = new ShaderStep(blurFragment, { image: { value: null }, step: { value: new THREE.Vector2() } })
  private height = 1
  private quarter = new THREE.Vector2(1, 1)

  constructor(
    private world: THREE.Scene,
    private view: THREE.Camera,
    /** The objects with a rim light and their settings, looked up fresh every frame. */
    private subjects: () => RimSubject[]
  ) {
    super('RimLightEffect', addFragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['rimTex', new THREE.Uniform(null)],
        ['glowTex', new THREE.Uniform(null)]
      ])
    })
    this.uniforms.get('rimTex')!.value = this.light.texture
    this.uniforms.get('glowTex')!.value = this.glow.texture
    this.step.uniforms.mask.value = this.mask.texture
    this.step.uniforms.maskDepth.value = this.mask.depthTexture
    this.downsample.uniforms.image.value = this.light.texture
    this.across.uniforms.image.value = this.glow.texture
    this.down.uniforms.image.value = this.spare.texture
  }

  setDepthTexture(
    depthTexture: THREE.Texture,
    depthPacking: THREE.DepthPackingStrategies = THREE.BasicDepthPacking
  ): void {
    const u = this.step.uniforms
    u.sceneDepth.value = depthTexture
    u.hasSceneDepth.value = !!depthTexture
    u.rgbaDepth.value = depthPacking === THREE.RGBADepthPacking
  }

  setSize(width: number, height: number): void {
    this.mask.setSize(width, height)
    this.light.setSize(width, height)
    this.height = Math.max(1, height)
    this.step.uniforms.texel.value.set(1 / Math.max(1, width), 1 / this.height)
    this.quarter.set(Math.max(1, Math.round(width / 4)), Math.max(1, Math.round(height / 4)))
    this.glow.setSize(this.quarter.x, this.quarter.y)
    this.spare.setSize(this.quarter.x, this.quarter.y)
  }

  update(renderer: THREE.WebGLRenderer): void {
    const clearColor = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderTarget(this.light)
    renderer.clear(true, false, false)
    const cam = this.view as THREE.PerspectiveCamera | THREE.OrthographicCamera
    const u = this.step.uniforms
    u.ortho.value = (cam as THREE.OrthographicCamera).isOrthographicCamera === true
    u.near.value = cam.near
    u.far.value = cam.far
    u.projInv.value.copy(cam.projectionMatrixInverse)
    // Sizes are in 720p pixels, so a 4K export looks like the preview.
    const px = this.height / 720
    let spread = 0
    for (const { root, rim } of this.subjects().slice(0, MAX_RIMS)) {
      if (rim.intensity <= 0 || rim.width <= 0) continue
      this.drawMask(renderer, root)
      u.color.value.set(rim.color)
      u.intensity.value = rim.intensity
      u.dir.value.set(...rimDirection(rim.angle))
      u.width.value = rim.width * px
      u.wrap.value = THREE.MathUtils.clamp(rim.wrap, 0, 1)
      this.step.render(renderer, null, this.light)
      spread = Math.max(spread, rim.width)
    }
    // The spill reaches about as far as the widest rim (in quarter-size pixels).
    const reach = THREE.MathUtils.clamp(spread / 6, 0.6, 3)
    this.downsample.uniforms.step.value.set(0.5 / Math.max(1, this.quarter.x), 0)
    this.downsample.render(renderer, null, this.glow)
    for (let i = 0; i < 2; i++) {
      this.across.uniforms.step.value.set(reach / this.quarter.x, 0)
      this.across.render(renderer, null, this.spare)
      this.down.uniforms.step.value.set(0, reach / this.quarter.y)
      this.down.render(renderer, null, this.glow)
    }
    renderer.setClearColor(clearColor, clearAlpha)
  }

  /** One object alone, with its depth, into the mask (alpha = the object). */
  private drawMask(renderer: THREE.WebGLRenderer, root: THREE.Object3D): void {
    const tagged: THREE.Object3D[] = []
    root.traverse((o) => {
      if (o.layers.isEnabled(HELPER_LAYER) || o.userData.helper) return
      o.layers.enable(MASK_LAYER)
      tagged.push(o)
    })
    const mask = this.view.layers.mask
    const background = this.world.background
    const autoClear = renderer.autoClear
    const shadows = renderer.shadowMap.autoUpdate
    this.view.layers.set(MASK_LAYER)
    this.world.background = null
    renderer.shadowMap.autoUpdate = false
    renderer.autoClear = false
    renderer.setRenderTarget(this.mask)
    renderer.clear(true, true, false)
    renderer.render(this.world, this.view)
    renderer.autoClear = autoClear
    renderer.shadowMap.autoUpdate = shadows
    this.world.background = background
    this.view.layers.mask = mask
    for (const o of tagged) o.layers.disable(MASK_LAYER)
  }

  dispose(): void {
    this.mask.depthTexture?.dispose()
    for (const t of [this.mask, this.light, this.glow, this.spare]) t.dispose()
    for (const s of [this.step, this.downsample, this.across, this.down]) s.dispose()
    super.dispose()
  }
}

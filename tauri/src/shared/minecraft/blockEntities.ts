// Chests and signs: blocks whose looks come from a block entity renderer (Java code), not a block model. The
// models themselves are the game's own (dumped with the mob models); this file holds what each vanilla renderer
// does around them: which model layer and texture, and how it places the model in the block.

/** A 4×4 column-major matrix (three.js `Matrix4.fromArray` order). */
export type Mat4 = number[]

const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

/** A PoseStack: each call multiplies on the right, like vanilla's translate / mulPose / scale. */
export class Pose {
  m: Mat4 = identity()
  translate(x: number, y: number, z: number): this {
    this.m = mul(this.m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
    return this
  }
  /** Rotation about +Y in degrees (Axis.YP.rotationDegrees). */
  rotateY(deg: number): this {
    const r = (deg * Math.PI) / 180
    const c = Math.cos(r)
    const s = Math.sin(r)
    this.m = mul(this.m, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
    return this
  }
  scale(x: number, y: number, z: number): this {
    this.m = mul(this.m, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
    return this
  }
  apply(p: [number, number, number]): [number, number, number] {
    const m = this.m
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ]
  }
}

/** Direction.toYRot(): the angle the game turns a block entity for each facing. */
const FACING_YROT: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 }

export type BlockEntityKind = 'chest' | 'sign' | 'wall_sign' | 'hanging_sign' | 'wall_hanging_sign'

export interface BlockEntityPlan {
  kind: BlockEntityKind
  /** Model layers to use, best first (names changed between versions). */
  layers: string[]
  /** Entity textures to try, best first. */
  textures: string[]
  /** Block space (0…1 per block, origin at the block's corner) from model space (model pixels). */
  matrix: Mat4
}

const SIGN = /^(.+?)_(wall_hanging_sign|hanging_sign|wall_sign|sign)$/
const CHEST = /^(?:waxed_)?(.*?)_?chest$/

/** Which block entity a block is (chests and signs), or null for every other block. */
export function blockEntityKind(block: string): BlockEntityKind | null {
  const id = block.replace(/^minecraft:/, '')
  const sign = SIGN.exec(id)
  if (sign) return sign[2] as BlockEntityKind
  if (CHEST.test(id) && !/^(chest_minecart|.*_chest_boat|chest_boat)$/.test(id)) return 'chest'
  return null
}

/** Where the game's renderer puts a chest or sign, and with which model and texture. Null for other blocks. */
export function blockEntityPlan(block: string, props: Record<string, string>): BlockEntityPlan | null {
  const id = block.replace(/^minecraft:/, '')
  const kind = blockEntityKind(id)
  if (!kind) return null
  const pose = new Pose()
  if (kind === 'chest') {
    // ChestRenderer: turn about the block centre by the facing; the model is in block pixels, Y up.
    const material = CHEST.exec(id)![1] || 'normal'
    const type = props.type ?? 'single'
    const half = type === 'single' ? '' : `_${type}`
    pose
      .translate(0.5, 0.5, 0.5)
      .rotateY(-(FACING_YROT[props.facing ?? 'north'] ?? 180))
      .translate(-0.5, -0.5, -0.5)
      .scale(1 / 16, 1 / 16, 1 / 16)
    // The ender chest has no double form.
    const single = type === 'single' || material === 'ender'
    return {
      kind,
      layers: single ? ['minecraft:chest#main'] : [`minecraft:double_chest${half}#main`, `minecraft:chest${half}#main`],
      textures: single
        ? [`entity/chest/${material}`, 'entity/chest/normal']
        : [`entity/chest/${material}${half}`, `entity/chest/normal${half}`],
      matrix: pose.m
    }
  }
  const wood = SIGN.exec(id)![1]
  if (kind === 'sign' || kind === 'wall_sign') {
    // SignRenderer: lifted to the board's height, turned, pushed against the wall for wall signs, then drawn at
    // 2/3 size with Y and Z flipped (model space has Y down).
    const yRot =
      kind === 'sign' ? -(Number(props.rotation ?? 0) * 22.5) : -(FACING_YROT[props.facing ?? 'north'] ?? 180)
    pose.translate(0.5, 0.5, 0.5).rotateY(yRot)
    if (kind === 'wall_sign') pose.translate(0, -0.3125, -0.4375)
    pose.scale(2 / 3 / 16, -2 / 3 / 16, -2 / 3 / 16)
    const standing = kind === 'sign'
    return {
      kind,
      layers: standing
        ? [`minecraft:sign/standing/${wood}#main`, `minecraft:sign/${wood}#main`]
        : [`minecraft:sign/wall/${wood}#main`, `minecraft:sign/${wood}#main`],
      textures: [`entity/signs/${wood}`, `entity/sign/${wood}`],
      matrix: pose.m
    }
  }
  // HangingSignRenderer: hung from the block's top, full size, Y and Z flipped.
  const yRot =
    kind === 'hanging_sign' ? -(Number(props.rotation ?? 0) * 22.5) : -(FACING_YROT[props.facing ?? 'north'] ?? 180)
  pose
    .translate(0.5, 0.9375, 0.5)
    .rotateY(yRot)
    .translate(0, -0.3125, 0)
    .scale(1 / 16, -1 / 16, -1 / 16)
  const attach = kind === 'wall_hanging_sign' ? 'wall' : props.attached === 'true' ? 'ceiling_middle' : 'ceiling'
  return {
    kind,
    layers: [`minecraft:hanging_sign/${wood}/${attach}#main`, `minecraft:hanging_sign/${wood}#main`],
    textures: [`entity/signs/hanging/${wood}`],
    matrix: pose.m
  }
}

/**
 * How a block entity model picked in the Mobs tab stands on its own: as the block it belongs to, facing the
 * camera, with its bottom centre on the object's origin. Null for models that aren't chests or signs.
 */
export function standaloneBlockEntity(layerKey: string): Mat4 | null {
  const model = layerKey.replace(/^minecraft:/, '').split('#')[0]
  const props = { facing: 'south', rotation: '0' }
  let block: string | null = null
  if (/^(chest|ender_chest|trapped_chest)$/.test(model)) block = 'chest'
  else if (/^(double_chest|chest)_(left|right)$/.test(model))
    return null // drawn as halves of a double chest only
  else if (/^sign\/(standing\/)?[a-z_]+$/.test(model)) block = `${model.split('/').pop()}_sign`
  else if (/^sign\/wall\/[a-z_]+$/.test(model)) block = `${model.split('/').pop()}_wall_sign`
  else if (/^hanging_sign\//.test(model)) block = `${model.split('/')[1]}_hanging_sign`
  if (!block) return null
  const plan = blockEntityPlan(block, props)!
  // Centre the block on the origin.
  const pose = new Pose().translate(-0.5, 0, -0.5)
  pose.m = mul(pose.m, plan.matrix)
  return pose.m
}

/** Texture paths for a sign model's layer (the game names its textures entity/signs/<wood>). */
export function signTextures(model: string): string[] {
  const m = /^(hanging_sign|sign)\/(?:standing\/|wall\/)?([a-z_]+)/.exec(model)
  if (!m) return []
  return m[1] === 'hanging_sign' ? [`entity/signs/hanging/${m[2]}`] : [`entity/signs/${m[2]}`]
}

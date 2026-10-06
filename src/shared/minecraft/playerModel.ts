// Vanilla player model (PlayerModel / HumanoidModel) with the standard 64×64 skin UV layout.
// Units are skin pixels; 1 block = 16 px. The player faces +Z, their right side is at -X.

export type PartName =
  | 'head'
  | 'body'
  | 'rightArm'
  | 'rightForearm'
  | 'leftArm'
  | 'leftForearm'
  | 'rightLeg'
  | 'rightShin'
  | 'leftLeg'
  | 'leftShin'

/** Every joint, parents before children. */
export const PART_NAMES: PartName[] = [
  'head',
  'body',
  'rightArm',
  'rightForearm',
  'leftArm',
  'leftForearm',
  'rightLeg',
  'rightShin',
  'leftLeg',
  'leftShin'
]

export interface BoxDef {
  /** Box min/max relative to the part's pivot, in pixels (three.js axes, y up). */
  from: [number, number, number]
  to: [number, number, number]
  /** Top-left of the box's UV net on the skin. */
  uv: [number, number]
  /** Outward inflation in pixels (overlay layers). */
  inflate: number
  overlay: boolean
  /**
   * For limbs split at the elbow/knee: this box covers skin rows [start, start + height) of a limb that is
   * `full` pixels tall. The cut ends are capped with the skin row at the cut so a bent joint looks solid.
   */
  rows?: { start: number; full: number }
  /** Vanilla's mirrored cube (left limbs of armor): texture flipped and the two side faces swapped. */
  mirror?: boolean
}

export interface PartDef {
  name: PartName
  /** Elbows and knees hang off their upper limb. */
  parent?: PartName
  /** Joint position in pixels: above the feet, or relative to the parent's joint. */
  pivot: [number, number, number]
  boxes: BoxDef[]
}

const box = (
  from: [number, number, number],
  size: [number, number, number],
  uv: [number, number],
  inflate = 0,
  overlay = false
): BoxDef => ({ from, to: [from[0] + size[0], from[1] + size[1], from[2] + size[2]], uv, inflate, overlay })

/**
 * A 12px limb split 6/6 into an upper part (pivot at shoulder/hip) and a lower part hanging from an
 * elbow/knee joint at the middle of the limb. Unbent, it looks exactly like the vanilla one-piece limb.
 */
function limb(
  name: PartName,
  lower: PartName,
  pivot: [number, number, number],
  from: [number, number, number],
  size: [number, number, number],
  uv: [number, number],
  overlayUv: [number, number]
): PartDef[] {
  const half = size[1] / 2
  const top = from[1] + size[1] // limb top relative to the pivot
  const joint: [number, number, number] = [from[0] + size[0] / 2, top - half, from[2] + size[2] / 2]
  const seg = (y0: number, start: number, origin: [number, number, number]): BoxDef[] =>
    [
      [uv, 0, false],
      [overlayUv, 0.25, true]
    ].map(([u, inflate, overlay]) => ({
      ...box(
        [from[0] - origin[0], y0 - origin[1], from[2] - origin[2]],
        [size[0], half, size[2]],
        u as [number, number],
        inflate as number,
        overlay as boolean
      ),
      rows: { start, full: size[1] }
    }))
  return [
    { name, pivot, boxes: seg(top - half, 0, [0, 0, 0]) },
    { name: lower, parent: name, pivot: joint, boxes: seg(from[1], half, joint) }
  ]
}

export function playerParts(slim: boolean): PartDef[] {
  const aw = slim ? 3 : 4
  const armY = slim ? 21.5 : 22
  return [
    {
      name: 'head',
      pivot: [0, 24, 0],
      boxes: [box([-4, 0, -4], [8, 8, 8], [0, 0]), box([-4, 0, -4], [8, 8, 8], [32, 0], 0.5, true)]
    },
    {
      name: 'body',
      pivot: [0, 24, 0],
      boxes: [box([-4, -12, -2], [8, 12, 4], [16, 16]), box([-4, -12, -2], [8, 12, 4], [16, 32], 0.25, true)]
    },
    ...limb('rightArm', 'rightForearm', [-5, armY, 0], [1 - aw, -10, -2], [aw, 12, 4], [40, 16], [40, 32]),
    ...limb('leftArm', 'leftForearm', [5, armY, 0], [-1, -10, -2], [aw, 12, 4], [32, 48], [48, 48]),
    ...limb('rightLeg', 'rightShin', [-1.9, 12, 0], [-2, -12, -2], [4, 12, 4], [0, 16], [0, 32]),
    ...limb('leftLeg', 'leftShin', [1.9, 12, 0], [-2, -12, -2], [4, 12, 4], [16, 48], [0, 48])
  ]
}

export interface BoxFace {
  /** TL, TR, BR, BL as seen from outside (clockwise). */
  corners: [number, number, number][]
  /** Skin pixel rect: [u0, v0, u1, v1]; corner TL maps to (u0, v0). */
  uv: [number, number, number, number]
  normal: [number, number, number]
}

/** The six faces of a box, mapped onto the skin's unfolded-box UV net. */
export function boxFaces(b: BoxDef): BoxFace[] {
  const w = b.to[0] - b.from[0]
  const h = b.to[1] - b.from[1]
  const d = b.to[2] - b.from[2]
  const i = b.inflate
  const [x1, y1, z1] = [b.from[0] - i, b.from[1] - i, b.from[2] - i]
  const [x2, y2, z2] = [b.to[0] + i, b.to[1] + i, b.to[2] + i]
  const [u, v] = b.uv
  // Side faces show rows [start, start + h) of the limb; cut ends show the skin row at the cut.
  const start = b.rows?.start ?? 0
  const full = b.rows?.full ?? h
  const sv0 = v + d + start
  const sv1 = sv0 + h
  const topUv: [number, number, number, number] =
    start > 0 ? [u + d, sv0, u + d + w, sv0 + 1] : [u + d, v, u + d + w, v + d]
  const bottomUv: [number, number, number, number] =
    start + h < full ? [u + d, sv1 - 1, u + d + w, sv1] : [u + d + w, v, u + d + 2 * w, v + d]
  const faces: BoxFace[] = [
    // front (+Z)
    {
      corners: [
        [x1, y2, z2],
        [x2, y2, z2],
        [x2, y1, z2],
        [x1, y1, z2]
      ],
      uv: [u + d, sv0, u + d + w, sv1],
      normal: [0, 0, 1]
    },
    // back (-Z)
    {
      corners: [
        [x2, y2, z1],
        [x1, y2, z1],
        [x1, y1, z1],
        [x2, y1, z1]
      ],
      uv: [u + 2 * d + w, sv0, u + 2 * d + 2 * w, sv1],
      normal: [0, 0, -1]
    },
    // player's right (-X)
    {
      corners: [
        [x1, y2, z1],
        [x1, y2, z2],
        [x1, y1, z2],
        [x1, y1, z1]
      ],
      uv: [u, sv0, u + d, sv1],
      normal: [-1, 0, 0]
    },
    // player's left (+X)
    {
      corners: [
        [x2, y2, z2],
        [x2, y2, z1],
        [x2, y1, z1],
        [x2, y1, z2]
      ],
      uv: [u + d + w, sv0, u + 2 * d + w, sv1],
      normal: [1, 0, 0]
    },
    // top (+Y): bottom edge of the UV rect touches the front face
    {
      corners: [
        [x1, y2, z1],
        [x2, y2, z1],
        [x2, y2, z2],
        [x1, y2, z2]
      ],
      uv: topUv,
      normal: [0, 1, 0]
    },
    // bottom (-Y): flipped vertically relative to the top
    {
      corners: [
        [x1, y1, z2],
        [x2, y1, z2],
        [x2, y1, z1],
        [x1, y1, z1]
      ],
      uv: bottomUv,
      normal: [0, -1, 0]
    }
  ]
  if (b.mirror) {
    const flip = (r: BoxFace['uv']): BoxFace['uv'] => [r[2], r[1], r[0], r[3]]
    const [right, left] = [faces[2].uv, faces[3].uv]
    faces[2].uv = left
    faces[3].uv = right
    for (const f of faces) f.uv = flip(f.uv)
  }
  return faces
}

/**
 * Converts a legacy 64×32 skin to the 64×64 layout and applies vanilla's alpha rules
 * (SkinTextureDownloader#processLegacySkin). `rgba` must be 64×32 or 64×64.
 */
export function normalizeSkin(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray<ArrayBuffer> {
  if (width !== 64 || (height !== 32 && height !== 64)) throw new Error(`Unsupported skin size ${width}×${height}`)
  const out = new Uint8ClampedArray(64 * 64 * 4)
  out.set(rgba.subarray(0, 64 * height * 4))
  const legacy = height === 32
  const px = (x: number, y: number): number => (y * 64 + x) * 4

  const copyRect = (sx: number, sy: number, dx: number, dy: number, w: number, h: number, mirrorX: boolean): void => {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const from = px(sx + i, sy + j)
        const to = px(sx + dx + (mirrorX ? w - 1 - i : i), sy + dy + j)
        for (let c = 0; c < 4; c++) out[to + c] = out[from + c]
      }
  }
  const setNoAlpha = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) out[px(x, y) + 3] = 255
  }
  const doNotchTransparencyHack = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) if (out[px(x, y) + 3] < 128) return
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) out[px(x, y) + 3] = 0
  }

  if (legacy) {
    copyRect(4, 16, 16, 32, 4, 4, true)
    copyRect(8, 16, 16, 32, 4, 4, true)
    copyRect(0, 20, 24, 32, 4, 12, true)
    copyRect(4, 20, 16, 32, 4, 12, true)
    copyRect(8, 20, 8, 32, 4, 12, true)
    copyRect(12, 20, 16, 32, 4, 12, true)
    copyRect(44, 16, -8, 32, 4, 4, true)
    copyRect(48, 16, -8, 32, 4, 4, true)
    copyRect(40, 20, 0, 32, 4, 12, true)
    copyRect(44, 20, -8, 32, 4, 12, true)
    copyRect(48, 20, -16, 32, 4, 12, true)
    copyRect(52, 20, -8, 32, 4, 12, true)
  }
  setNoAlpha(0, 0, 32, 16)
  if (legacy) doNotchTransparencyHack(32, 0, 64, 32)
  setNoAlpha(0, 16, 64, 32)
  setNoAlpha(16, 48, 48, 64)
  return out
}

/** Degrees per joint, applied X then Y then Z around each part's pivot. Elbows/knees bend around X. */
export type Pose = Record<PartName, [number, number, number]>

/** Fills in joints missing from older projects (saved before elbows and knees existed). */
export function fullPose(p: Partial<Pose> | undefined): Pose {
  return Object.fromEntries(PART_NAMES.map((n) => [n, [...(p?.[n] ?? [0, 0, 0])] as [number, number, number]])) as Pose
}

const preset = (p: Partial<Pose>): Pose => fullPose(p)

export const POSES: Record<string, Pose> = {
  Standing: preset({
    head: [0, 0, 0],
    body: [0, 0, 0],
    rightArm: [0, 0, 0],
    leftArm: [0, 0, 0],
    rightLeg: [0, 0, 0],
    leftLeg: [0, 0, 0]
  }),
  Walking: preset({
    head: [0, 0, 0],
    body: [0, 0, 0],
    rightArm: [30, 0, 0],
    leftArm: [-30, 0, 0],
    rightLeg: [-30, 0, 0],
    leftLeg: [30, 0, 0]
  }),
  Running: preset({
    head: [-5, 0, 0],
    body: [0, 0, 0],
    rightArm: [60, 0, 0],
    leftArm: [-60, 0, 0],
    rightLeg: [-55, 0, 0],
    leftLeg: [55, 0, 0]
  }),
  Pointing: preset({
    head: [0, -20, 0],
    body: [0, 0, 0],
    rightArm: [-90, 15, 0],
    leftArm: [0, 0, 5],
    rightLeg: [0, 0, 0],
    leftLeg: [0, 0, 0]
  }),
  Shocked: preset({
    head: [-10, 0, 0],
    body: [0, 0, 0],
    rightArm: [-150, 0, -25],
    leftArm: [-150, 0, 25],
    rightLeg: [0, 0, -5],
    leftLeg: [0, 0, 5]
  }),
  Waving: preset({
    head: [0, 10, 0],
    body: [0, 0, 0],
    rightArm: [0, 0, 0],
    leftArm: [-160, 0, -20],
    rightLeg: [0, 0, 0],
    leftLeg: [0, 0, 0]
  }),
  Thinking: preset({
    head: [15, -15, 5],
    body: [0, 0, 0],
    rightArm: [-110, -30, 0],
    leftArm: [-40, 30, 0],
    rightLeg: [0, 0, 0],
    leftLeg: [0, 0, 0]
  }),
  // Action poses (elbows and knees bend: forearm X is minus the elbow angle, shin X is the knee angle).
  Sprinting: preset({
    head: [-12, 0, 0],
    rightArm: [75, 0, 0],
    rightForearm: [-50, 0, 0],
    leftArm: [-85, 0, 0],
    leftForearm: [-60, 0, 0],
    rightLeg: [-70, 0, 0],
    rightShin: [25, 0, 0],
    leftLeg: [55, 0, 0],
    leftShin: [80, 0, 0]
  }),
  'Sword swing': preset({
    head: [8, -10, 0],
    rightArm: [-155, -25, 15],
    rightForearm: [-35, 0, 0],
    leftArm: [-35, 20, -20],
    leftForearm: [-40, 0, 0],
    rightLeg: [-25, 0, 0],
    rightShin: [20, 0, 0],
    leftLeg: [30, 0, -5]
  }),
  Lunge: preset({
    head: [5, -15, 0],
    rightArm: [-95, -15, 0],
    leftArm: [45, 0, -15],
    leftForearm: [-20, 0, 0],
    rightLeg: [-60, 0, 0],
    rightShin: [65, 0, 0],
    leftLeg: [40, 0, 0],
    leftShin: [10, 0, 0]
  }),
  Blocking: preset({
    head: [12, 0, 0],
    rightArm: [-30, 0, 15],
    rightForearm: [-30, 0, 0],
    leftArm: [-75, 45, 0],
    leftForearm: [-80, 0, 0],
    rightLeg: [-15, 0, 5],
    rightShin: [20, 0, 0],
    leftLeg: [20, 0, -5],
    leftShin: [15, 0, 0]
  }),
  'Bow aim': preset({
    head: [0, 15, 0],
    rightArm: [-90, -5, 0],
    leftArm: [-90, 40, 0],
    leftForearm: [-35, 0, 0],
    rightLeg: [-10, 0, 0],
    leftLeg: [15, 0, 0]
  }),
  Leaping: preset({
    head: [-20, 0, 0],
    rightArm: [-165, 0, -20],
    rightForearm: [-15, 0, 0],
    leftArm: [-140, 0, 25],
    leftForearm: [-20, 0, 0],
    rightLeg: [-75, 0, 0],
    rightShin: [90, 0, 0],
    leftLeg: [35, 0, 0],
    leftShin: [70, 0, 0]
  }),
  Victory: preset({
    head: [-15, 0, 0],
    rightArm: [-170, 0, -12],
    rightForearm: [-15, 0, 0],
    leftArm: [0, 0, 10],
    rightLeg: [0, 0, -4],
    leftLeg: [0, 0, 4]
  }),
  'Zombie walk': preset({
    head: [5, 0, 0],
    rightArm: [-90, 0, 0],
    leftArm: [-85, 0, 0],
    rightLeg: [-25, 0, 0],
    rightShin: [15, 0, 0],
    leftLeg: [20, 0, 0]
  }),
  Sitting: preset({
    head: [5, 0, 0],
    rightArm: [-35, 0, 5],
    leftArm: [-35, 0, -5],
    rightLeg: [-90, 8, 0],
    leftLeg: [-90, -8, 0]
  })
}

export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet'
export const ARMOR_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs', 'feet']

/**
 * Armor boxes (HumanoidArmorModel) per player part, on the 64×32 armor texture. Helmet, chestplate and boots
 * use the outer model (inflated 1px), leggings the inner one (0.5px) and the second texture layer. Arms and
 * legs are split at the elbow/knee like the player, so armor bends with the limb. Armor arms are always 4px
 * wide (vanilla doesn't slim them), sharing the player's shoulder pivot.
 */
export function armorBoxes(slot: ArmorSlot, slim: boolean): { part: PartName; box: BoxDef }[] {
  const parts = playerParts(slim)
  const pivotOf = (n: PartName): [number, number, number] => parts.find((p) => p.name === n)!.pivot
  const inflate = slot === 'legs' ? 0.5 : 1
  const whole = (
    part: PartName,
    from: [number, number, number],
    size: [number, number, number],
    uv: [number, number],
    extra = 0
  ) => ({
    part,
    box: box(from, size, uv, inflate + extra)
  })
  // A 12px limb box split at the joint: rows 0–6 on the upper part, 6–12 on the lower one.
  const limbPair = (
    upper: PartName,
    lower: PartName,
    from: [number, number, number],
    uv: [number, number],
    mirror: boolean
  ) => {
    const joint = pivotOf(lower)
    const top = from[1] + 12
    const seg = (y0: number, start: number, origin: [number, number, number]): BoxDef => ({
      ...box([from[0] - origin[0], y0 - origin[1], from[2] - origin[2]], [4, 6, 4], uv, inflate),
      rows: { start, full: 12 },
      mirror
    })
    return [
      { part: upper, box: seg(top - 6, 0, [0, 0, 0]) },
      { part: lower, box: seg(from[1], 6, joint) }
    ]
  }
  switch (slot) {
    case 'head':
      return [whole('head', [-4, 0, -4], [8, 8, 8], [0, 0]), whole('head', [-4, 0, -4], [8, 8, 8], [32, 0], 0.5)]
    case 'chest':
      return [
        whole('body', [-4, -12, -2], [8, 12, 4], [16, 16]),
        ...limbPair('rightArm', 'rightForearm', [-3, -10, -2], [40, 16], false),
        ...limbPair('leftArm', 'leftForearm', [-1, -10, -2], [40, 16], true)
      ]
    case 'legs':
      return [
        whole('body', [-4, -12, -2], [8, 12, 4], [16, 16]),
        ...limbPair('rightLeg', 'rightShin', [-2, -12, -2], [0, 16], false),
        ...limbPair('leftLeg', 'leftShin', [-2, -12, -2], [0, 16], true)
      ]
    case 'feet':
      return [
        ...limbPair('rightLeg', 'rightShin', [-2, -12, -2], [0, 16], false),
        ...limbPair('leftLeg', 'leftShin', [-2, -12, -2], [0, 16], true)
      ]
  }
}

/** Vanilla renders players at 0.9375 scale (PlayerRenderer). Blocks per skin pixel: */
export const PLAYER_PIXEL = 0.9375 / 16

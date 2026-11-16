// Finding a way across blocks: from where a character stands to a spot you click, on foot where it can, by swimming,
// up ladders and vines, and over gaps with a jump. Pure: it asks a `Grid` what is in each block.
import type { Vec3 } from './animation'

export type Block = 'air' | 'solid' | 'water' | 'lava' | 'hurt' | 'climb'

/** The world as blocks: `at` is what fills the block whose lowest corner is (x, y, z). */
export interface Grid {
  at(x: number, y: number, z: number): Block
  /** For a ladder or vine: which way its open side faces (a unit step in x and z), if known. */
  facing?(x: number, y: number, z: number): [number, number] | null
}

export type Move = 'walk' | 'swim' | 'climb' | 'leap'

/** One block of the route: where the character's feet are, and how it got there from the block before. */
export interface Step {
  x: number
  y: number
  z: number
  move: Move
}

export interface Route {
  steps: Step[]
  /** False when there is no way to the spot: the route goes as near as it could. */
  reached: boolean
}

export interface RouteOptions {
  /** Longest fall that is walked off (blocks). */
  drop?: number
  /** Longest gap that can be jumped, counted from take-off block to landing block. */
  leap?: number
  /** Most blocks the search may look at before it gives up. */
  limit?: number
  /** How far past the two ends the search may wander (blocks). */
  margin?: number
}

const passable = (b: Block): boolean => b === 'air' || b === 'water' || b === 'climb'

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
]

/** A binary heap of [priority, id], smallest first. */
class Heap {
  private a: number[] = []
  private ids: number[] = []
  get size(): number {
    return this.a.length
  }
  push(p: number, id: number): void {
    let i = this.a.length
    this.a.push(p)
    this.ids.push(id)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.a[parent] <= p) break
      this.a[i] = this.a[parent]
      this.ids[i] = this.ids[parent]
      i = parent
    }
    this.a[i] = p
    this.ids[i] = id
  }
  pop(): number {
    const top = this.ids[0]
    const p = this.a.pop()!
    const id = this.ids.pop()!
    const n = this.a.length
    if (n) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && this.a[c + 1] < this.a[c]) c++
        if (this.a[c] >= p) break
        this.a[i] = this.a[c]
        this.ids[i] = this.ids[c]
        i = c
      }
      this.a[i] = p
      this.ids[i] = id
    }
    return top
  }
}

/**
 * The cheapest way from the block `from` (feet) to `to`. Moves: walking (one block up, a few down, diagonals that
 * don't cut corners), swimming, climbing ladders and vines, and leaping a gap of a few blocks.
 */
export function findRoute(grid: Grid, from: Vec3, to: Vec3, opts: RouteOptions = {}): Route {
  const maxDrop = opts.drop ?? 3
  const maxLeap = opts.leap ?? 4
  const limit = opts.limit ?? 60000
  const margin = opts.margin ?? 14
  const [sx, sy, sz] = from.map(Math.floor)
  const [gx, gy, gz] = to.map(Math.floor)
  const x0 = Math.min(sx, gx) - margin
  const x1 = Math.max(sx, gx) + margin
  const z0 = Math.min(sz, gz) - margin
  const z1 = Math.max(sz, gz) + margin
  const y0 = Math.min(sy, gy) - 24
  const y1 = Math.max(sy, gy) + 24
  const W = x1 - x0 + 1
  const D = z1 - z0 + 1
  const H = y1 - y0 + 1
  const id = (x: number, y: number, z: number): number => x - x0 + (z - z0) * W + (y - y0) * W * D
  const inside = (x: number, y: number, z: number): boolean =>
    x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= y0 && y <= y1
  const total = W * D * H
  if (total > 40_000_000) return { steps: [{ x: sx, y: sy, z: sz, move: 'walk' }], reached: false }

  // Per block, what the grid says (asked once).
  const memo = new Map<number, Block>()
  const at = (x: number, y: number, z: number): Block => {
    const k = id(x, y, z)
    let b = memo.get(k)
    if (b === undefined) memo.set(k, (b = grid.at(x, y, z)))
    return b
  }
  const clear = (x: number, y: number, z: number): boolean => passable(at(x, y, z)) && passable(at(x, y + 1, z))
  const floor = (x: number, y: number, z: number): boolean => at(x, y - 1, z) === 'solid'
  /** Somewhere feet can be: on the ground, in water, or on a ladder. */
  const stands = (x: number, y: number, z: number): boolean =>
    clear(x, y, z) && (floor(x, y, z) || at(x, y, z) === 'water' || at(x, y, z) === 'climb')

  const cost = new Map<number, number>()
  const from_ = new Map<number, number>()
  const how = new Map<number, Move>()
  const key = (x: number, y: number, z: number): number => id(x, y, z)
  const unkey = (k: number): [number, number, number] => {
    const x = k % W
    const z = Math.floor(k / W) % D
    const y = Math.floor(k / (W * D))
    return [x + x0, y + y0, z + z0]
  }
  const h = (x: number, z: number): number => Math.hypot(x - gx, z - gz)

  const closed = new Set<number>()
  const heap = new Heap()
  const start = key(sx, sy, sz)
  cost.set(start, 0)
  heap.push(h(sx, sz), start)
  let best = start
  let bestH = h(sx, sz) + Math.abs(sy - gy) * 0.1
  let seen = 0
  let goal = -1

  const relax = (nk: number, nx: number, nz: number, c: number, from: number, move: Move): void => {
    const old = cost.get(nk)
    if (old !== undefined && old <= c) return
    cost.set(nk, c)
    from_.set(nk, from)
    how.set(nk, move)
    heap.push(c + h(nx, nz), nk)
  }

  while (heap.size && seen < limit) {
    const k = heap.pop()
    const c = cost.get(k)!
    const [x, y, z] = unkey(k)
    // A stale heap entry: the block was already settled by a cheaper way.
    if (closed.has(k)) continue
    closed.add(k)
    seen++
    if (x === gx && z === gz && Math.abs(y - gy) <= 1) {
      goal = k
      break
    }
    const score = h(x, z) + Math.abs(y - gy) * 0.1
    if (score < bestH) {
      bestH = score
      best = k
    }
    const here = at(x, y, z)
    const onFloor = floor(x, y, z)

    // Walking, wading and swimming sideways.
    for (const [dx, dz] of DIRS) {
      const nx = x + dx
      const nz = z + dz
      if (!inside(nx, y, nz)) continue
      const diagonal = dx !== 0 && dz !== 0
      if (diagonal && !(clear(x + dx, y, z) && clear(x, y, z + dz))) continue
      const step = diagonal ? Math.SQRT2 : 1
      // Level, or a stride up one block.
      if (stands(nx, y, nz)) {
        const water = at(nx, y, nz) === 'water'
        relax(key(nx, y, nz), nx, nz, c + step * (water ? 2 : 1), k, water ? 'swim' : 'walk')
      } else if (clear(nx, y, nz) && at(nx, y, nz) !== 'lava') {
        // Nothing to stand on: a drop of up to `maxDrop`, to ground (or into water).
        for (let d = 1; d <= maxDrop; d++) {
          const ny = y - d
          if (!inside(nx, ny, nz) || !passable(at(nx, ny, nz))) break
          if (stands(nx, ny, nz)) {
            const water = at(nx, ny, nz) === 'water'
            relax(key(nx, ny, nz), nx, nz, c + step + 0.4 * d + (water ? 1 : 0), k, water ? 'swim' : 'walk')
            break
          }
        }
      }
      // A step up onto a block (from the ground, a ladder or the water).
      if (
        inside(nx, y + 1, nz) &&
        at(nx, y, nz) === 'solid' &&
        passable(at(x, y + 2, z)) &&
        stands(nx, y + 1, nz) &&
        !diagonal
      )
        relax(key(nx, y + 1, nz), nx, nz, c + 1.5, k, 'walk')
    }

    // Up and down a ladder or vine, and up and down in water.
    if (here === 'climb') {
      if (inside(x, y + 1, z) && clear(x, y + 1, z) && at(x, y + 1, z) === 'climb')
        relax(key(x, y + 1, z), x, z, c + 1.5, k, 'climb')
      if (inside(x, y - 1, z) && clear(x, y - 1, z) && at(x, y - 1, z) === 'climb')
        relax(key(x, y - 1, z), x, z, c + 1.2, k, 'climb')
      // Down to the ground at the foot of it.
      if (inside(x, y - 1, z) && !onFloor && at(x, y - 1, z) !== 'solid' && stands(x, y - 1, z))
        relax(key(x, y - 1, z), x, z, c + 1.2, k, 'climb')
    } else if (here === 'water') {
      if (inside(x, y + 1, z) && at(x, y + 1, z) === 'water' && clear(x, y + 1, z))
        relax(key(x, y + 1, z), x, z, c + 2, k, 'swim')
      if (inside(x, y - 1, z) && stands(x, y - 1, z)) {
        const water = at(x, y - 1, z) === 'water'
        relax(key(x, y - 1, z), x, z, c + (water ? 2 : 1), k, water ? 'swim' : 'walk')
      }
    }

    // Leaping across a gap: straight over, landing level, a block lower or (for short ones) a block higher.
    if (onFloor && here !== 'water' && passable(at(x, y + 2, z))) {
      for (const [dx, dz] of DIRS.slice(0, 4)) {
        let gap = false
        for (let dist = 1; dist <= maxLeap; dist++) {
          const nx = x + dx * dist
          const nz = z + dz * dist
          if (!inside(nx, y, nz)) break
          // The way over must be clear to head height and a little above for the arc.
          if (!clear(nx, y, nz) || !passable(at(nx, y + 2, nz))) break
          if (!floor(nx, y, nz)) gap = true
          if (dist >= 2 && gap) {
            for (const dy of [0, -1, 1]) {
              if (dy === 1 && dist > 3) continue
              const ny = y + dy
              if (!inside(nx, ny, nz) || !stands(nx, ny, nz) || at(nx, ny, nz) !== 'air' || !floor(nx, ny, nz)) continue
              if (dy === 1 && !passable(at(nx, y + 2, nz))) continue
              relax(key(nx, ny, nz), nx, nz, c + 3 + 1.5 * dist, k, 'leap')
            }
          }
        }
      }
    }
  }

  const end = goal >= 0 ? goal : best
  const steps: Step[] = []
  for (let k: number | undefined = end; k !== undefined; k = from_.get(k)) {
    const [x, y, z] = unkey(k)
    steps.push({ x, y, z, move: how.get(k) ?? 'walk' })
  }
  steps.reverse()
  return { steps, reached: goal >= 0 }
}

/** A stretch of the route done one way, as the waypoints (feet, in blocks) to follow. */
export interface Leg {
  move: Move
  points: Vec3[]
  /** A climb: the way to face (radians, 0 faces +Z), toward the wall behind the ladder. */
  face?: number
}

/**
 * The route cut into stretches by how they are done, as world points. Walking stretches lose the points on straight
 * lines; swimming rides at the water's surface; climbing hugs the wall behind the ladder.
 */
export function legsOf(steps: Step[], grid?: Pick<Grid, 'facing'>): Leg[] {
  const legs: Leg[] = []
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i]
    const last = legs.at(-1)
    const p = pointOf(s, grid)
    if (last && last.move === s.move && s.move !== 'leap') last.points.push(p)
    else {
      const leg: Leg = { move: s.move, points: [pointOf({ ...steps[i - 1], move: 'walk' }, undefined), p] }
      // A climber faces the wall the ladder is on.
      const f = s.move === 'climb' ? grid?.facing?.(s.x, s.y, s.z) : null
      if (f) leg.face = Math.atan2(-f[0], -f[1])
      legs.push(leg)
    }
  }
  return legs.map((l) => (l.move === 'walk' ? { ...l, points: simplify(l.points) } : l))
}

function pointOf(s: Step, grid: Pick<Grid, 'facing'> | undefined): Vec3 {
  if (s.move === 'swim') return [s.x + 0.5, s.y + 0.55, s.z + 0.5]
  if (s.move === 'climb') {
    // Ladders sit against a wall: the climber stands close to it.
    const f = grid?.facing?.(s.x, s.y, s.z)
    return f ? [s.x + 0.5 - f[0] * 0.3, s.y, s.z + 0.5 - f[1] * 0.3] : [s.x + 0.5, s.y, s.z + 0.5]
  }
  return [s.x + 0.5, s.y, s.z + 0.5]
}

/** Drops the points that lie on the straight line between their neighbours, at the same height. */
export function simplify(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1]
    const b = points[i]
    const c = points[i + 1]
    const d1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const d2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
    const n1 = Math.hypot(...d1)
    const n2 = Math.hypot(...d2)
    const same = n1 > 0 && n2 > 0 && d1.every((v, j) => Math.abs(v / n1 - d2[j] / n2) < 1e-6)
    if (!same) out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}

// ------------------------------------------------------------------ blocks

/** Things that are in a block but not in the way: plants, signs, torches, doors, plates, rails. */
const OPEN =
  /^(air|cave_air|void_air|light|structure_void|short_grass|grass|tall_grass|fern|large_fern|dead_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|sapling|propagule|mushroom|brown_mushroom|red_mushroom|torch|wall_torch|redstone_torch|redstone_wall_torch|soul_torch|soul_wall_torch|redstone_wire|lever|tripwire|tripwire_hook|string|cobweb|snow|sugar_cane|nether_sprouts|crimson_roots|warped_roots|crimson_fungus|warped_fungus|hanging_roots|glow_lichen|sculk_vein|moss_carpet|pale_moss_carpet|frogspawn|lily_pad|spore_blossom|big_dripleaf_stem|torchflower|pitcher_plant|sunflower|lilac|rose_bush|peony|poppy|dandelion|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|closed_eyeblossom|open_eyeblossom|nether_wart|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem|sweet_berry_bush|torchflower_crop|pitcher_crop|end_rod|flower_pot|skeleton_skull|wither_skeleton_skull|zombie_head|player_head|creeper_head|dragon_head|piglin_head|skeleton_wall_skull|wither_skeleton_wall_skull|zombie_wall_head|player_wall_head|creeper_wall_head|dragon_wall_head|piglin_wall_head|chain|iron_chain|lightning_rod|candle)$|_(sign|wall_sign|hanging_sign|wall_hanging_sign|banner|wall_banner|button|pressure_plate|carpet|door|fence_gate|rail|bed|coral_fan|coral_wall_fan|sapling|tulip|flower|torch|candle|head|skull)$|^(potted_|dead_.*coral$|.*_coral$|.*_pressure_plate$)|_rail$|_bud$|_cluster$|^rail$|^(sticky_)?piston_head$|^moving_piston$/

/** Things that hurt to stand in or on. */
const HURT =
  /^(cactus|magma_block|fire|soul_fire|campfire|soul_campfire|wither_rose|powder_snow|sweet_berry_bush|pointed_dripstone)$/

const CLIMB =
  /^(ladder|vine|scaffolding|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/

const WATERY = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/

/** What a block of this kind means to a walker. */
export function blockKind(name: string, properties: Record<string, string> = {}): Block {
  const short = name.replace(/^minecraft:/, '')
  if (short === 'lava') return 'lava'
  if (WATERY.test(short)) return 'water'
  if (CLIMB.test(short)) return 'climb'
  if (HURT.test(short)) return 'hurt'
  if (OPEN.test(short)) return properties.waterlogged === 'true' ? 'water' : 'air'
  return 'solid'
}

const FACES: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }

/** Which way a ladder's open side faces. */
export const facingOf = (properties: Record<string, string> = {}): [number, number] | null =>
  FACES[properties.facing ?? ''] ?? null

/**
 * The block to stand in near a point: the feet block there if it can hold someone, else the nearest one a block or
 * two up or down (and a block to either side, for a point on an edge).
 */
export function standingCell(grid: Grid, p: Vec3): [number, number, number] | null {
  const x = Math.floor(p[0])
  const z = Math.floor(p[2])
  const ok = (cx: number, cy: number, cz: number): boolean => {
    const a = grid.at(cx, cy, cz)
    const b = grid.at(cx, cy + 1, cz)
    const open = (v: Block): boolean => v === 'air' || v === 'water' || v === 'climb'
    return open(a) && open(b) && (grid.at(cx, cy - 1, cz) === 'solid' || a === 'water' || a === 'climb')
  }
  const y0 = Math.round(p[1])
  const columns: [number, number][] = [
    [x, z],
    [x - 1, z],
    [x + 1, z],
    [x, z - 1],
    [x, z + 1]
  ]
  for (const [cx, cz] of columns)
    for (const dy of [0, -1, 1, -2, 2, -3, 3]) if (ok(cx, y0 + dy, cz)) return [cx, y0 + dy, cz]
  return null
}

// ------------------------------------------------------------------ keeping to open ground

/** The height a walker standing near (x, z) would be at, going up at most a block from `y`; null where there is none. */
function floorNear(grid: Grid, x: number, y: number, z: number): number | null {
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  for (let cy = Math.floor(y) + 1; cy >= Math.floor(y) - 4; cy--)
    if (grid.at(cx, cy - 1, cz) === 'solid' && passable(grid.at(cx, cy, cz)) && passable(grid.at(cx, cy + 1, cz)))
      return cy
  return null
}

/** The block to stand in at a point: the one over the floor there, else the nearest place to stand. */
function cellFor(grid: Grid, p: Vec3): [number, number, number] | null {
  const f = floorNear(grid, p[0], p[1], p[2])
  return f !== null ? [Math.floor(p[0]), f, Math.floor(p[2])] : standingCell(grid, p)
}

/** Whether walking straight from a to b runs into a wall, a trunk, a hole or a cliff. */
export function blockedBetween(grid: Grid, a: Vec3, b: Vec3): boolean {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2])
  const n = Math.max(1, Math.ceil(len / 0.3))
  let y = floorNear(grid, a[0], a[1], a[2]) ?? a[1]
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const f = floorNear(grid, a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t)
    if (f === null || y - f > 3) return true
    y = f
  }
  return false
}

/**
 * Keeps a drawn path to open ground: any stretch that would walk into something is replaced by the way round it
 * (found over the blocks), ending at the same point. Stretches that are clear, or that have no walking way round
 * (they would need a swim, a climb or a leap), are left as they were.
 */
export function avoidObstacles(grid: Grid, points: Vec3[], opts: RouteOptions = {}): Vec3[] {
  if (points.length < 2) return points
  const out: Vec3[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!blockedBetween(grid, a, b)) {
      out.push(b)
      continue
    }
    const from = cellFor(grid, a)
    const to = cellFor(grid, b)
    const route = from && to ? findRoute(grid, from, to, opts) : null
    if (!route?.reached || route.steps.some((s) => s.move !== 'walk')) {
      out.push(b)
      continue
    }
    const via = legsOf(route.steps, grid).flatMap((l) => l.points.slice(1))
    out.push(...via.slice(0, -1), b)
  }
  return out
}

// Two-bone IK for player limbs: given where the hand or foot should be, find the shoulder/hip rotation and the
// elbow/knee bend. Elbows only bend forward and knees only backward, like real joints.
import * as THREE from 'three'
import { playerParts, type PartName } from '@shared/minecraft/playerModel'

export type Limb = 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg'
export const LOWER: Record<Limb, PartName> = {
  rightArm: 'rightForearm',
  leftArm: 'leftForearm',
  rightLeg: 'rightShin',
  leftLeg: 'leftShin'
}
/** Which limb a clicked part belongs to. */
export function limbOf(part: PartName): Limb | null {
  for (const [limb, lower] of Object.entries(LOWER) as [Limb, PartName][])
    if (part === limb || part === lower) return limb
  return null
}

const BEND_SIGN: Record<Limb, number> = { rightArm: -1, leftArm: -1, rightLeg: 1, leftLeg: 1 }
const MAX_BEND = THREE.MathUtils.degToRad(160)

export interface LimbGeometry {
  /** Shoulder/hip joint in the player's frame (pixels). */
  pivot: THREE.Vector3
  /** Upper bone: shoulder → elbow, in the upper part's frame. */
  upper: THREE.Vector3
  /** Lower bone: elbow → hand tip, in the lower part's frame. */
  lower: THREE.Vector3
}

export function limbGeometry(limb: Limb, slim: boolean): LimbGeometry {
  const parts = playerParts(slim)
  const up = parts.find((p) => p.name === limb)!
  const low = parts.find((p) => p.name === LOWER[limb])!
  return {
    pivot: new THREE.Vector3(...up.pivot),
    upper: new THREE.Vector3(...low.pivot),
    lower: new THREE.Vector3(0, low.boxes[0].from[1], 0) // the bottom of the lower box, under the joint
  }
}

/** Hand/foot tip for a given pose of the limb, in the player's frame (pixels). */
export function limbEnd(g: LimbGeometry, upperDeg: number[], lowerDeg: number[]): THREE.Vector3 {
  const d = THREE.MathUtils.degToRad
  const rU = new THREE.Euler(d(upperDeg[0]), d(upperDeg[1]), d(upperDeg[2]), 'ZYX')
  const rL = new THREE.Euler(d(lowerDeg[0]), d(lowerDeg[1]), d(lowerDeg[2]), 'ZYX')
  return g.lower.clone().applyEuler(rL).add(g.upper).applyEuler(rU).add(g.pivot)
}

/**
 * Solves the limb so its tip reaches `target` (player frame, pixels; clamped to the limb's reach).
 * Returns degrees for the upper part (X, Y, Z) and the lower part (bend around X only).
 */
export function solveLimb(limb: Limb, g: LimbGeometry, target: THREE.Vector3): { upper: number[]; lower: number[] } {
  const sign = BEND_SIGN[limb]
  const reach = (bend: number): number =>
    g.lower
      .clone()
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), sign * bend)
      .add(g.upper)
      .length()
  const toTarget = target.clone().sub(g.pivot)
  const dist = THREE.MathUtils.clamp(toTarget.length(), reach(MAX_BEND) + 1e-3, reach(0) - 1e-3)
  // Reach shrinks as the joint bends: bisect for the bend that matches the distance.
  let lo = 0
  let hi = MAX_BEND
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (reach(mid) > dist) lo = mid
    else hi = mid
  }
  const bend = sign * ((lo + hi) / 2)
  const tip = g.lower
    .clone()
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), bend)
    .add(g.upper)
  // Then turn the whole limb so the tip points at the target (the smallest such rotation).
  const q = new THREE.Quaternion().setFromUnitVectors(tip.normalize(), toTarget.normalize())
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX')
  const deg = THREE.MathUtils.radToDeg
  const round = (v: number): number => Math.round(v * 10) / 10
  return { upper: [e.x, e.y, e.z].map((v) => round(deg(v))), lower: [round(deg(bend)), 0, 0] }
}

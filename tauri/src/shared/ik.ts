// Reaching: where a player's arm must point and bend for its hand to land on a spot, solved as a two-bone chain
// (shoulder, elbow, hand) in the character's own frame.
import * as THREE from 'three'
import { PLAYER_PIXEL, type Pose } from './minecraft/playerModel'

type Vec3 = [number, number, number]
const D2R = Math.PI / 180

/** A character standing at `position`, facing `yaw` (radians; 0 faces +Z), at `scale`. */
export interface Stance {
  position: Vec3
  yaw: number
  scale: number
  slim?: boolean
}

/** The shoulder's place in the character's own frame (blocks, from the feet). */
export function shoulderOf(side: 'left' | 'right', stance: Pick<Stance, 'scale' | 'slim'>): THREE.Vector3 {
  const k = PLAYER_PIXEL * (stance.scale || 1)
  return new THREE.Vector3((side === 'right' ? -5 : 5) * k, (stance.slim ? 21.5 : 22) * k, 0)
}

/** Length of each half of the arm (shoulder to elbow, elbow to hand), blocks. */
export const armBone = (scale: number): number => 6 * PLAYER_PIXEL * (scale || 1)

/** A world point in the character's frame (turned back by its heading). */
export function toLocal(p: Vec3, stance: Stance): THREE.Vector3 {
  const x = p[0] - stance.position[0]
  const y = p[1] - stance.position[1]
  const z = p[2] - stance.position[2]
  const c = Math.cos(stance.yaw)
  const s = Math.sin(stance.yaw)
  return new THREE.Vector3(x * c - z * s, y, x * s + z * c)
}

/**
 * The joint angles (degrees, as a Pose stores them) that put the hand on `target` (a world point), or as near as
 * the arm reaches. The elbow bends down and out. `reach` tells how close the hand got (1 is all the way there).
 */
export function armToward(
  target: Vec3,
  side: 'left' | 'right',
  stance: Stance
): { arm: Vec3; forearm: Vec3; reach: number } {
  const L = armBone(stance.scale)
  const S = shoulderOf(side, stance)
  const T = toLocal(target, stance)
  const v = T.clone().sub(S)
  const want = Math.max(1e-4, v.length())
  const d = Math.min(Math.max(want, 0.05 * L), 2 * L - 1e-5)
  const vh = v.clone().normalize()
  // Triangle shoulder-elbow-hand: the elbow's interior angle and the shoulder's angle off the straight line.
  const gamma = Math.acos(THREE.MathUtils.clamp((2 * L * L - d * d) / (2 * L * L), -1, 1))
  const alpha = Math.acos(THREE.MathUtils.clamp(d / (2 * L), -1, 1))
  // The elbow swings toward down-and-out.
  const pole = new THREE.Vector3(side === 'right' ? -0.35 : 0.35, -1, -0.1)
  const perp = pole.sub(vh.clone().multiplyScalar(pole.dot(vh)))
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1).sub(vh.clone().multiplyScalar(vh.z))
  perp.normalize()
  const upper = vh.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha)).normalize()
  const elbow = S.clone().addScaledVector(upper, L)
  const hand = S.clone().add(vh.clone().multiplyScalar(d))
  const lower = hand.clone().sub(elbow).normalize()

  // Hanging straight down is no turn at all; swing the arm's own down axis onto the upper bone...
  const q1 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), upper)
  // ...then roll it about that bone until its forward side faces the way the forearm bends.
  const bendDir = lower.clone().sub(upper.clone().multiplyScalar(lower.dot(upper)))
  if (bendDir.lengthSq() > 1e-8) {
    bendDir.normalize()
    const f1 = new THREE.Vector3(0, 0, 1).applyQuaternion(q1)
    const angle = Math.atan2(upper.dot(f1.clone().cross(bendDir)), f1.dot(bendDir))
    q1.premultiply(new THREE.Quaternion().setFromAxisAngle(upper, angle))
  }
  const e = new THREE.Euler().setFromQuaternion(q1, 'XYZ')
  const bend = Math.PI - gamma
  return {
    arm: [e.x / D2R, e.y / D2R, e.z / D2R],
    // Forward is minus on the forearm, as in every preset.
    forearm: [-bend / D2R, 0, 0],
    reach: Math.min(1, d / want)
  }
}

/** The reaching arm's angles dropped into a pose (the rest of it is left as it was). */
export function reachPose(pose: Pose, target: Vec3, side: 'left' | 'right', stance: Stance, weight = 1): Pose {
  const { arm, forearm } = armToward(target, side, stance)
  const out = { ...pose }
  const a = side === 'right' ? 'rightArm' : 'leftArm'
  const f = side === 'right' ? 'rightForearm' : 'leftForearm'
  const mix = (from: Vec3, to: Vec3): Vec3 => from.map((v, i) => v + (to[i] - v) * weight) as Vec3
  out[a] = mix(pose[a], arm)
  out[f] = mix(pose[f], forearm)
  return out
}

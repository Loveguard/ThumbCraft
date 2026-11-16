// Things a character does by itself on top of what its blocks say: breathing, and looking at something.
import { PLAYER_PIXEL, type Pose } from './minecraft/playerModel'
import type { Stance } from './ik'

type Vec3 = [number, number, number]

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Slow breathing: the chest rises a touch and the arms ride with it. Added to whatever pose there is. */
export function breathe(pose: Pose, t: number, amount = 1): Pose {
  const b = Math.sin((2 * Math.PI * t) / 3.4)
  return {
    ...pose,
    body: [pose.body[0] + 0.8 * b * amount, pose.body[1], pose.body[2]],
    head: [pose.head[0] - 0.5 * b * amount, pose.head[1], pose.head[2]],
    rightArm: [pose.rightArm[0], pose.rightArm[1], pose.rightArm[2] - 1.2 * b * amount],
    leftArm: [pose.leftArm[0], pose.leftArm[1], pose.leftArm[2] + 1.2 * b * amount]
  }
}

/**
 * Talking: the head nods and sways with how loud the sound is (`level` 0…1 at time `t`), by `amount`. Minecraft
 * heads have no mouth, so a talker is told by the bob.
 */
export function talk(pose: Pose, level: number, t: number, amount = 1): Pose {
  if (level <= 0.001 || amount <= 0) return pose
  const k = level * amount
  return {
    ...pose,
    head: [
      pose.head[0] + k * (6 + 2.5 * Math.sin(2 * Math.PI * 3.1 * t)),
      pose.head[1] + k * 4 * Math.sin(2 * Math.PI * 1.1 * t),
      pose.head[2] + k * 1.5 * Math.sin(2 * Math.PI * 0.7 * t)
    ],
    body: [pose.body[0] + 0.6 * k, pose.body[1], pose.body[2]]
  }
}

/**
 * Turns the head toward a world point: the angles that face it, kept within what a neck does (about 75° round, 40°
 * up and down). `amount` (0…1) is how much of the turn it makes. Positive yaw looks toward the character's left.
 */
export function lookAt(pose: Pose, stance: Stance, target: Vec3, amount = 1): Pose {
  const eye: Vec3 = [
    stance.position[0],
    stance.position[1] + 25 * PLAYER_PIXEL * (stance.scale || 1),
    stance.position[2]
  ]
  const dx = target[0] - eye[0]
  const dy = target[1] - eye[1]
  const dz = target[2] - eye[2]
  const flat = Math.hypot(dx, dz)
  if (flat < 1e-3 && Math.abs(dy) < 1e-3) return pose
  let yaw = Math.atan2(dx, dz) - stance.yaw
  while (yaw > Math.PI) yaw -= 2 * Math.PI
  while (yaw < -Math.PI) yaw += 2 * Math.PI
  const deg = (r: number): number => (r * 180) / Math.PI
  // Looking up is minus on the head's X, as in every preset.
  const pitch = -deg(Math.atan2(dy, flat))
  const y = clamp(deg(yaw), -75, 75) * amount
  const x = clamp(pitch, -40, 40) * amount
  return { ...pose, head: [pose.head[0] * (1 - amount) + x, pose.head[1] * (1 - amount) + y, pose.head[2]] }
}

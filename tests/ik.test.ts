import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { armBone, armToward, shoulderOf, toLocal, type Stance } from '@shared/ik'

const D2R = Math.PI / 180

/** Forward kinematics: where the hand is for these angles, in the character's own frame. */
function handOf(arm: number[], forearm: number[], side: 'left' | 'right', stance: Stance): THREE.Vector3 {
  const L = armBone(stance.scale)
  const up = new THREE.Quaternion().setFromEuler(new THREE.Euler(arm[0] * D2R, arm[1] * D2R, arm[2] * D2R, 'XYZ'))
  const low = new THREE.Quaternion().setFromEuler(new THREE.Euler(forearm[0] * D2R, 0, 0, 'XYZ'))
  const elbow = shoulderOf(side, stance).add(new THREE.Vector3(0, -L, 0).applyQuaternion(up))
  return elbow.add(new THREE.Vector3(0, -L, 0).applyQuaternion(up.clone().multiply(low)))
}

describe('arm reach', () => {
  const stance: Stance = { position: [2, 0, 3], yaw: 0.7, scale: 1 }
  const spots: [number, number, number][] = [
    [0, 1.2, 0.5],
    [-0.3, 1.5, 0.4],
    [0.1, 0.95, 0.4],
    [-0.2, 1.05, 0.45],
    [0.2, 1.35, 0.5]
  ]
  for (const side of ['right', 'left'] as const)
    it(`puts the ${side} hand on a spot within reach`, () => {
      let reached = 0
      for (const s of spots) {
        // Spots are given in the character's frame; the solver is handed the world point.
        const c = Math.cos(stance.yaw)
        const sn = Math.sin(stance.yaw)
        const world: [number, number, number] = [
          stance.position[0] + s[0] * c + s[2] * sn,
          stance.position[1] + s[1],
          stance.position[2] - s[0] * sn + s[2] * c
        ]
        const mine = toLocal(world, stance)
        const reach = armToward(world, side, stance)
        const hand = handOf(reach.arm, reach.forearm, side, stance)
        if (reach.reach >= 0.999) {
          reached++
          expect(hand.distanceTo(mine)).toBeLessThan(2e-3)
        }
      }
      expect(reached).toBeGreaterThanOrEqual(3)
    })

  it('stretches as far as it can toward a spot out of reach', () => {
    const far: [number, number, number] = [2, 1.2, 8]
    const r = armToward(far, 'right', stance)
    expect(r.reach).toBeLessThan(0.6)
    expect(Math.abs(r.forearm[0])).toBeLessThan(1)
  })
})

import { lookAt } from '@shared/procedural'
import { fullPose } from '@shared/minecraft/playerModel'

describe('looking at things', () => {
  const stance: Stance = { position: [0, 0, 0], yaw: 0, scale: 1 }
  const stand = fullPose(undefined)
  it('turns the head to either side and up or down', () => {
    expect(lookAt(stand, stance, [5, 1.5, 0]).head[1]).toBeCloseTo(75, 0)
    expect(lookAt(stand, stance, [-5, 1.5, 5]).head[1]).toBeLessThan(-30)
    expect(lookAt(stand, stance, [0, 5, 4]).head[0]).toBeLessThan(-30)
    expect(lookAt(stand, stance, [0, 0, 4]).head[0]).toBeGreaterThan(5)
  })
  it('takes the way the body faces into account', () => {
    expect(lookAt(stand, { ...stance, yaw: Math.PI / 2 }, [5, 1.5, 0]).head[1]).toBeCloseTo(0, 0)
  })
  it('does as much of the turn as asked', () => {
    expect(lookAt(stand, stance, [3, 1.5, 3], 0.5).head[1]).toBeCloseTo(22.5, 0)
  })
})

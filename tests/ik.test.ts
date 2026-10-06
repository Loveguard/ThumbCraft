import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { limbEnd, limbGeometry, solveLimb } from '../src/renderer/src/minecraft/ik'

describe('limb IK', () => {
  it('reaches a target within range and bends the elbow forward', () => {
    const g = limbGeometry('rightArm', false)
    // A point in front of the chest, closer than the straight arm reaches.
    const target = new THREE.Vector3(-3, 16, 5)
    const { upper, lower } = solveLimb('rightArm', g, target)
    const end = limbEnd(g, upper, lower)
    expect(end.distanceTo(target)).toBeLessThan(0.05)
    expect(lower[0]).toBeLessThan(0) // elbows bend with negative X here
  })

  it('bends knees the other way', () => {
    const g = limbGeometry('leftLeg', false)
    const target = new THREE.Vector3(1.9, 4, 3)
    const { upper, lower } = solveLimb('leftLeg', g, target)
    expect(limbEnd(g, upper, lower).distanceTo(target)).toBeLessThan(0.05)
    expect(lower[0]).toBeGreaterThan(0)
  })

  it('stretches straight towards targets out of reach', () => {
    const g = limbGeometry('rightArm', false)
    const { lower } = solveLimb('rightArm', g, new THREE.Vector3(-5, 22, 40))
    // The shoulder sits off-centre, so the longest reach is a hair short of fully straight.
    expect(Math.abs(lower[0])).toBeLessThan(5)
  })
})

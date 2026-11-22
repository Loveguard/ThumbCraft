import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { contactOf, makeFloor } from '../src/renderer/src/groundLock'
import { lightningFlicker } from '@shared/minecraft/lightning'
import { vfxLayers, VFX_PRESETS } from '../src/renderer/src/vfx'

/** A box standing on y = bottom, `h` tall, centred on (x, z). */
function block(x: number, z: number, bottom: number, h: number, w = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w))
  m.position.set(x, bottom + h / 2, z)
  return m
}

/** A stand-in character: a 0.6 wide, 1.8 tall box with its feet at its origin. */
function character(y: number): { root: THREE.Group; model: THREE.Group } {
  const root = new THREE.Group()
  const model = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6))
  body.position.y = 0.9
  model.add(body)
  root.add(model)
  root.position.y = y
  return { root, model }
}

describe('ground lock', () => {
  const ground = new THREE.Group()
  ground.add(block(0.5, 0.5, 0, 1)) // a full block: top at 1
  ground.add(block(1.5, 0.5, 0, 0.5)) // a slab: top at 0.5
  const floor = makeFloor([ground])!

  it('finds the true top of full blocks and slabs', () => {
    expect(floor(0.5, 0.5, 5)).toBeCloseTo(1)
    expect(floor(1.5, 0.5, 5)).toBeCloseTo(0.5)
    expect(floor(3.5, 0.5, 5)).toBeNull()
    // Nothing above the height it looks from.
    expect(floor(0.5, 0.5, 0.9)).toBeNull()
  })

  it('sees a character sunk into the ground', () => {
    const c = character(0.8)
    c.root.position.x = 0.5
    c.root.position.z = 0.5
    const contact = contactOf(c.model, floor, 0.8, 1)
    expect(contact.sink).toBeCloseTo(0.2)
  })

  it('sees a character hovering over a slab', () => {
    const c = character(0.8)
    c.root.position.set(1.5, 0.8, 0.5)
    const contact = contactOf(c.model, floor, 0.8, 1)
    expect(contact.sink).toBe(0)
    expect(contact.gap).toBeCloseTo(0.3)
  })

  it('treats a wall well above the feet as a wall, not ground', () => {
    const c = character(0)
    c.root.position.set(0.5, -0.2, 0.5)
    // Sunk 1.2 under the top: deeper than a step, so not lifted onto it.
    expect(contactOf(c.model, floor, -0.2, 1).sink).toBe(0)
  })
})

describe('moving effects', () => {
  it('gives every effect layer a motion', () => {
    for (const p of VFX_PRESETS)
      for (const layer of vfxLayers(p.id, 0.5, 1)) expect(layer.motion.travel).toBeGreaterThan(0)
  })

  it('strikes lightning in bursts and never lets it vanish for long', () => {
    const samples = Array.from({ length: 250 }, (_, i) => lightningFlicker(i / 100, 5))
    expect(Math.max(...samples)).toBeGreaterThan(1)
    expect(Math.min(...samples)).toBeLessThan(0.3)
    // Outside the strikes it glows on.
    expect(samples.filter((v) => v >= 0.3).length).toBeGreaterThan(200)
  })
})

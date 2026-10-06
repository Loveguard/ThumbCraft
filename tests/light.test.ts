import { describe, expect, it } from 'vitest'
import { computeLight, lightEmission, vanillaLightmap } from '@shared/minecraft/light'

// Palette: 0 air, 1 stone (solid), 2 torch, 3 leaves.
const opacity = (i: number): number => [0, 15, 0, 1][i]
const emission = (i: number): number => (i === 2 ? 14 : 0)

describe('block and sky light', () => {
  it('spreads torch light one level per block and stops at solid blocks', () => {
    const sx = 9
    const blocks = new Uint8Array(sx) // a 9×1×1 row
    blocks[2] = 2 // torch
    blocks[5] = 1 // wall
    const { block } = computeLight(sx, 1, 1, blocks, opacity, emission, false)
    expect(Array.from(block)).toEqual([12, 13, 14, 13, 12, 0, 0, 0, 0])
  })

  it('lets full sky light fall straight down and dims it under leaves', () => {
    // Column of 4 (top to bottom: air, leaves, air, air), stored bottom-up.
    const blocks = new Uint8Array([0, 0, 3, 0])
    const { sky } = computeLight(1, 4, 1, blocks, opacity, emission, true)
    expect(Array.from(sky)).toEqual([12, 13, 14, 15])
  })

  it('knows vanilla emitters and their states', () => {
    expect(lightEmission('minecraft:torch', {})).toBe(14)
    expect(lightEmission('minecraft:redstone_lamp', { lit: 'false' })).toBe(0)
    expect(lightEmission('minecraft:sea_pickle', { pickles: '4', waterlogged: 'true' })).toBe(15)
    expect(lightEmission('minecraft:white_candle', { lit: 'true', candles: '3' })).toBe(9)
    expect(lightEmission('minecraft:stone', {})).toBe(0)
  })
})

describe('vanilla lightmap', () => {
  const at = (m: Uint8Array, sky: number, block: number): number[] =>
    Array.from(m.slice((sky * 16 + block) * 4, (sky * 16 + block) * 4 + 3))

  it('is near white in full daylight and dark at midnight', () => {
    const noon = vanillaLightmap(1, 'overworld')
    const night = vanillaLightmap(0.2, 'overworld')
    expect(at(noon, 15, 0).every((v) => v > 245)).toBe(true)
    expect(at(night, 15, 0)[0]).toBeLessThan(at(noon, 15, 0)[0])
    // No light at all keeps vanilla's ~10% floor at the default Brightness.
    expect(at(noon, 0, 0)[0]).toBeLessThan(30)
  })

  it('gives torch light its warm colour as it falls off', () => {
    const night = vanillaLightmap(0.2, 'overworld')
    const [r, g, b] = at(night, 0, 8)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    // Right next to the torch it saturates to near white, as in-game.
    expect(at(night, 0, 14).every((v) => v > 240)).toBe(true)
  })
})

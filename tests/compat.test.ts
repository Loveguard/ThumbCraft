import { describe, expect, it } from 'vitest'
import { compareVersions, isSupported, locateCommand, releaseTimeOf } from '../src/shared/minecraft/compat'

describe('version support', () => {
  it('supports 1.18 and newer only', () => {
    for (const id of ['1.18', '1.18.2', '1.20.3', '1.21.4']) expect(isSupported(id), id).toBe(true)
    for (const id of ['1.16.5', '1.17.1', '1.12.2']) expect(isSupported(id), id).toBe(false)
  })

  it('uses the right biome-locating command', () => {
    expect(locateCommand('1.18.2')).toBe('locatebiome')
    expect(locateCommand('1.19')).toBe('locate biome')
    expect(locateCommand('1.21', '2024-06-13T12:00:00+00:00')).toBe('locate biome')
  })

  it('treats unknown ids (snapshots, modded names) as current unless a release time says otherwise', () => {
    expect(isSupported('fabric-loader-0.16')).toBe(true)
    expect(isSupported('24w14a', '2024-04-03T12:00:00+00:00')).toBe(true)
    expect(releaseTimeOf('1.18.1')).toBe(Date.parse('2021-11-30'))
  })

  it('compares dotted versions', () => {
    expect(compareVersions('1.20.4', '1.21')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.21', '1.21.0')).toBe(0)
  })
})

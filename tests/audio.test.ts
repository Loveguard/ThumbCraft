import { describe, expect, it } from 'vitest'
import { findBeats, levelAt, loudness, snapToBeats, waveformPeaks } from '@shared/audio'

const RATE = 8000

/** A click every `period` seconds, starting at `first`, on a bed of faint noise. */
function clicks(seconds: number, period: number, first: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE))
  let seed = 1
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.01
  }
  for (let t = first; t < seconds; t += period) {
    const start = Math.floor(t * RATE)
    for (let i = 0; i < 0.03 * RATE && start + i < out.length; i++)
      out[start + i] += Math.sin(i * 0.9) * 0.9 * Math.exp(-i / (0.01 * RATE))
  }
  return out
}

describe('findBeats', () => {
  it('finds the tempo and where the beats fall', () => {
    const { bpm, beats } = findBeats(clicks(20, 0.5, 0.13), RATE)
    expect(bpm).toBeGreaterThan(118.5)
    expect(bpm).toBeLessThan(121.5)
    expect(beats.length).toBeGreaterThan(30)
    expect(Math.abs(beats[0] - 0.13)).toBeLessThan(0.04)
    expect(Math.abs(beats[10] - 5.13)).toBeLessThan(0.08)
  })

  it('finds a slower beat too', () => {
    const { bpm } = findBeats(clicks(24, 0.8, 0.2), RATE)
    expect(bpm).toBeGreaterThan(73)
    expect(bpm).toBeLessThan(77)
  })

  it('finds no beat in silence or in a short sound', () => {
    expect(findBeats(new Float32Array(RATE * 10), RATE).bpm).toBeNull()
    expect(findBeats(clicks(1, 0.5, 0), RATE).beats).toEqual([])
  })
})

describe('snapToBeats', () => {
  const beats = [0, 0.5, 1, 1.5]
  it('snaps to a beat that is close and leaves the rest', () => {
    expect(snapToBeats(0.54, beats)).toBe(0.5)
    expect(snapToBeats(0.76, beats)).toBe(0.76)
    expect(snapToBeats(9, beats)).toBe(9)
    expect(snapToBeats(0.3, [])).toBe(0.3)
  })
})

describe('loudness and waveform', () => {
  it('follows a sound getting loud and quiet', () => {
    const s = new Float32Array(RATE * 2)
    for (let i = 0; i < RATE; i++) s[i] = Math.sin(i * 0.3) * 0.8
    const env = loudness(s, RATE)
    expect(levelAt(env, 0.5)).toBeGreaterThan(0.8)
    expect(levelAt(env, 1.5)).toBeLessThan(0.1)
    expect(levelAt(env, 5)).toBe(0)
    expect(levelAt(env, -1)).toBe(0)
  })
  it('gives the peak of each slice', () => {
    const s = new Float32Array(1000)
    s[10] = 0.5
    s[600] = -1
    const p = waveformPeaks(s, 2)
    expect(p).toEqual([0.5, 1])
  })
})

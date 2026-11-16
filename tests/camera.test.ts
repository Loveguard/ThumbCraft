import { describe, expect, it } from 'vitest'
import { cameraAt, planCamera, startFor, type CamClip, type CameraData, type Subject } from '@shared/camera'

const home = {
  position: [0, 3, -8] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
  fov: 70
}
const still = (): Subject => ({ position: [0, 0, 0], yaw: 0 })
const clip = (
  id: string,
  type: CamClip['type'],
  start: number,
  duration: number,
  extra: Partial<CamClip> = {}
): CamClip => ({
  id,
  type,
  start,
  duration,
  subject: 'a',
  ...extra
})
const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const run = (clips: CamClip[]): ((t: number) => ReturnType<typeof cameraAt>) => {
  const data: CameraData = { home, clips }
  const plan = planCamera(data, still)
  return (t) => cameraAt(plan, t, still)
}

describe('camera blocks', () => {
  it('leaves the camera alone before the first block and holds the end after the last', () => {
    const at = run([clip('o', 'orbit', 1, 2)])
    expect(at(0.5)).toBeNull()
    const end = at(3)!
    expect(at(10)!.position).toEqual(end.position)
  })

  it('circles the subject at a steady distance', () => {
    const at = run([clip('o', 'bullet', 0, 4)])
    const d0 = dist(at(0)!.position, [0, 1, 0])
    for (const t of [0.7, 1.5, 2.6, 3.9]) expect(dist(at(t)!.position, [0, 1, 0])).toBeCloseTo(d0, 3)
    // A bullet-time turn comes all the way round.
    expect(dist(at(4)!.position, at(0)!.position)).toBeLessThan(1e-3)
  })

  it('pushes in and pulls back', () => {
    const d = (t: number, at: ReturnType<typeof run>): number => dist(at(t)!.position, at(t)!.target)
    const push = run([clip('p', 'push', 0, 2)])
    expect(d(2, push)).toBeLessThan(d(0, push) * 0.7)
    const pull = run([clip('p', 'pull', 0, 2)])
    expect(d(2, pull)).toBeGreaterThan(d(0, pull) * 1.4)
  })

  it('starts each block where the one before ended', () => {
    const at = run([clip('o', 'orbit', 0, 2), clip('p', 'push', 2, 2)])
    expect(dist(at(2)!.position, at(2 - 1e-4)!.position)).toBeLessThan(0.01)
    expect(dist(at(2 + 1e-4)!.position, at(2)!.position)).toBeLessThan(0.01)
  })

  it('keeps the subject the same size through a dolly zoom', () => {
    const at = run([clip('d', 'dolly', 0, 2)])
    const size = (t: number): number => dist(at(t)!.position, [0, 1, 0]) * Math.tan((at(t)!.fov * Math.PI) / 360)
    expect(size(1)).toBeCloseTo(size(0), 3)
    expect(size(2)).toBeCloseTo(size(0), 3)
    expect(at(2)!.fov).toBeLessThan(at(0)!.fov)
  })

  it('follows a character that walks away', () => {
    const walker = (_id: string, t: number): Subject => ({ position: [0, 0, 2 * t], yaw: 0 })
    const plan = planCamera({ home, clips: [clip('f', 'follow', 0, 4)] }, walker)
    const a = cameraAt(plan, 0, walker)!
    const b = cameraAt(plan, 4, walker)!
    expect(b.position[2] - a.position[2]).toBeCloseTo(8, 3)
    expect(b.target[2] - a.target[2]).toBeCloseTo(8, 3)
  })

  it('goes behind the character for an over-the-shoulder shot', () => {
    const at = run([clip('s', 'shoulder', 0, 3, { subject: 'a' })])
    const v = at(3)!
    expect(v.position[2]).toBeLessThan(-2)
    expect(v.target[2]).toBeGreaterThan(3)
  })

  it('shakes by hand without drifting off', () => {
    const at = run([clip('h', 'handheld', 0, 3)])
    const moved = dist(at(1.3)!.position, home.position)
    expect(moved).toBeGreaterThan(0.001)
    expect(moved).toBeLessThan(0.2)
  })
})

describe('startFor', () => {
  it('makes a block show the wanted view part-way through', () => {
    const clip = { id: 'c', type: 'orbit' as const, start: 1, duration: 4 }
    const wanted = {
      position: [3, 2, 5] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
      fov: 50
    }
    const start = startFor(clip, wanted, 3, () => null)
    const plan = planCamera({ home: start, clips: [clip] }, () => null)
    const got = cameraAt(plan, 3, () => null)!
    expect(got.position[0]).toBeCloseTo(3, 2)
    expect(got.position[2]).toBeCloseTo(5, 2)
  })
  it('uses the view itself at the start of the block', () => {
    const clip = { id: 'c', type: 'push' as const, start: 0, duration: 2 }
    const wanted = {
      position: [0, 2, 6] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
      fov: 50
    }
    expect(startFor(clip, wanted, 0, () => null)).toEqual(wanted)
  })
})

import { describe, expect, it } from 'vitest'
import { parseScript, segments } from '@shared/script'

const cast = { characters: ['Alex', 'Steve'], places: ['Cave', 'Warden', 'Chest', 'Pond'] }

describe('segments', () => {
  it('cuts on commas, then, and and full stops', () => {
    expect(segments('Alex walks to the cave, sees the Warden, panics, runs')).toHaveLength(4)
    expect(segments('walks then waves. Sits down')).toEqual(['walks', 'waves', 'Sits down'])
    expect(segments('waves and nods')).toEqual(['waves', 'nods'])
  })
})

describe('parseScript', () => {
  it('turns the example from the plan into steps', () => {
    const { steps, unknown } = parseScript('Alex walks to the cave, sees the Warden, panics, runs', cast)
    expect(unknown).toEqual([])
    expect(steps.map((s) => s.kind)).toEqual(['go', 'look', 'clip', 'go'])
    expect(steps[0]).toMatchObject({ kind: 'go', subject: 'Alex', to: 'Cave', gait: 'walk' })
    expect(steps[1]).toMatchObject({ kind: 'look', at: 'Warden' })
    expect(steps[2]).toMatchObject({ kind: 'clip', type: 'panic', subject: 'Alex' })
    expect(steps[3]).toMatchObject({ kind: 'go', gait: 'run', subject: 'Alex' })
  })

  it('switches who is doing things when another one is named', () => {
    const { steps } = parseScript('Alex waves. Steve nods, laughs', cast)
    expect(steps.map((s) => (s as { subject: string }).subject)).toEqual(['Alex', 'Steve', 'Steve'])
  })

  it('reads lengths and distances', () => {
    const { steps } = parseScript('Alex waves for 4 seconds, walks 12 blocks', cast)
    expect(steps[0]).toMatchObject({ type: 'wave', duration: 4 })
    expect(steps[1]).toMatchObject({ kind: 'go', blocks: 12, to: null })
  })

  it('picks camera moves', () => {
    const { steps } = parseScript('the camera orbits Alex, then zooms in', cast)
    expect(steps.map((s) => (s as { type: string }).type)).toEqual(['orbit', 'push'])
  })

  it('reaches for a named thing', () => {
    const { steps } = parseScript('Steve opens the chest', cast)
    expect(steps[0]).toMatchObject({ kind: 'clip', type: 'reach', target: 'Chest' })
  })

  it('keeps what it does not understand to say so', () => {
    const { steps, unknown } = parseScript('Alex waves, contemplates the void', cast)
    expect(steps).toHaveLength(1)
    expect(unknown).toEqual(['contemplates the void'])
  })
})

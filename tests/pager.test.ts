import { describe, expect, it } from 'vitest'
import { pageButtons } from '../src/renderer/src/components/controls'

describe('page selector', () => {
  it('lists every page when there are only a few', () => {
    expect(pageButtons(0, 4)).toEqual([0, 1, 2, 3])
  })

  it('keeps the first, last and neighbouring pages and folds the rest into gaps', () => {
    expect(pageButtons(0, 10)).toEqual([0, 1, null, 9])
    expect(pageButtons(4, 10)).toEqual([0, null, 3, 4, 5, null, 9])
    expect(pageButtons(9, 10)).toEqual([0, null, 8, 9])
  })

  it('shows a single skipped page instead of a gap', () => {
    expect(pageButtons(3, 10)).toEqual([0, 1, 2, 3, 4, null, 9])
  })
})

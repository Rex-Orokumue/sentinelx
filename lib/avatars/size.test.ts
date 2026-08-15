import { describe, it, expect } from 'vitest'
import { SIZE_PX, BORDER_WIDTH_PX, hexHeight } from './size'

describe('hexHeight', () => {
  it('is width * 0.866 for every size key', () => {
    for (const width of Object.values(SIZE_PX)) {
      expect(hexHeight(width)).toBeCloseTo(width * 0.866, 5)
    }
  })
})

describe('SIZE_PX', () => {
  it('matches the spec sizes', () => {
    expect(SIZE_PX).toEqual({ xs: 28, sm: 40, md: 56, lg: 80, xl: 112 })
  })
})

describe('BORDER_WIDTH_PX', () => {
  it('matches the tier table', () => {
    expect(BORDER_WIDTH_PX).toEqual({ recruit: 2, guardian: 3, elite: 3, sentinel: 4, legend: 4 })
  })
})

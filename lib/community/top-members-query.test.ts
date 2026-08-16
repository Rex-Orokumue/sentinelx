import { describe, it, expect } from 'vitest'
import { rankIcon } from './top-members-query'

describe('rankIcon', () => {
  it('returns a medal emoji for the top 3 ranks', () => {
    expect(rankIcon(1)).toBe('🥇')
    expect(rankIcon(2)).toBe('🥈')
    expect(rankIcon(3)).toBe('🥉')
  })

  it('returns the plain rank number past 3rd place', () => {
    expect(rankIcon(4)).toBe('4')
    expect(rankIcon(5)).toBe('5')
    expect(rankIcon(10)).toBe('10')
  })
})

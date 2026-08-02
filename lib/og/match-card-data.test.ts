import { describe, it, expect } from 'vitest'
import { selectCardVariant, resultWinnerSide } from './match-card-data'

describe('selectCardVariant', () => {
  it('returns result for a completed match', () => {
    expect(selectCardVariant('completed')).toBe('result')
  })

  it('returns hype for scheduled, live, disputed, cancelled, and bye', () => {
    for (const status of ['scheduled', 'live', 'disputed', 'cancelled', 'bye', 'forfeited']) {
      expect(selectCardVariant(status)).toBe('hype')
    }
  })
})

describe('resultWinnerSide', () => {
  it('picks the higher score', () => {
    expect(resultWinnerSide(3, 1)).toBe('player_a')
    expect(resultWinnerSide(1, 3)).toBe('player_b')
  })

  it('returns null for a draw', () => {
    expect(resultWinnerSide(2, 2)).toBeNull()
  })

  it('returns null when either score is missing', () => {
    expect(resultWinnerSide(null, 2)).toBeNull()
    expect(resultWinnerSide(2, null)).toBeNull()
  })
})

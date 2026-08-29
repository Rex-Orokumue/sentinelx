import { describe, it, expect } from 'vitest'
import { opponentDisplayName } from './opponent'

describe('opponentDisplayName', () => {
  it('returns the opponent name when there is one', () => {
    expect(opponentDisplayName('Chi - Boy', 'scheduled')).toBe('Chi - Boy')
  })

  it('returns BYE for an empty slot on a bye match', () => {
    expect(opponentDisplayName(null, 'bye')).toBe('BYE')
  })

  it('returns TBD for an empty slot that is not a bye', () => {
    expect(opponentDisplayName(null, 'scheduled')).toBe('TBD')
  })

  it('treats empty string as no name', () => {
    expect(opponentDisplayName('', 'bye')).toBe('BYE')
  })

  it('prefers a real name even on a bye status (defensive)', () => {
    expect(opponentDisplayName('Arole', 'bye')).toBe('Arole')
  })
})

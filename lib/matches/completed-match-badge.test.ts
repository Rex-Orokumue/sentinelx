import { describe, it, expect } from 'vitest'
import { completedMatchBadge } from './completed-match-badge'

describe('completedMatchBadge', () => {
  it('returns null for a normally confirmed match', () => {
    expect(completedMatchBadge('completed', null)).toBeNull()
  })
  it('labels a knockout double-forfeit', () => {
    expect(completedMatchBadge('forfeited', null)).toBe('FORFEITED')
  })
  it('labels a walkover', () => {
    expect(completedMatchBadge('completed', 'walkover')).toBe('WALKOVER')
  })
  it('labels a group no-show draw', () => {
    expect(completedMatchBadge('completed', 'no_show_draw')).toBe('NO-SHOW DRAW')
  })
})

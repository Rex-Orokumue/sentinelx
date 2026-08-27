import { describe, it, expect } from 'vitest'
import { roundRobinPairs } from './draw'

// generate()'s round_robin branch (lib/tournaments/bracket-admin-actions.ts)
// is exercised indirectly through closeRegistration in live/manual testing
// (this codebase's Supabase-backed admin actions are not unit-tested with
// mocks). This unit test covers the one new pure computation the branch
// introduces: that a round-robin group's match count is always n(n-1)/2,
// which the completion-trigger logic in lib/matches/verify-actions.ts
// depends on being exact.
describe('round_robin field size', () => {
  it('produces n(n-1)/2 fixtures for a full field', () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i}`)
    expect(roundRobinPairs(players)).toHaveLength((8 * 7) / 2)
  })
})

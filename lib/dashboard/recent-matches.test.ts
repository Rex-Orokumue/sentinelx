import { describe, it, expect } from 'vitest'
import { mapRecentMatches, type RawRecentMatchRow } from './recent-matches'

const base: RawRecentMatchRow = {
  id: 'm1',
  player_a_id: 'me',
  player_b_id: 'opp',
  score_a: 3,
  score_b: 1,
  updated_at: '2026-08-12T00:00:00Z',
  opponentName: 'HIM',
  opponentUsername: 'him',
  tournamentTitle: 'Community Club #2',
}

describe('mapRecentMatches', () => {
  it('marks a win when I am player A with the higher score', () => {
    expect(mapRecentMatches([base], 'me')[0]).toMatchObject({ outcome: 'win', myScore: 3, opponentScore: 1 })
  })
  it('marks a loss when I am player B with the lower score', () => {
    const row = { ...base, player_a_id: 'opp', player_b_id: 'me', score_a: 3, score_b: 1 }
    expect(mapRecentMatches([row], 'me')[0]).toMatchObject({ outcome: 'loss', myScore: 1, opponentScore: 3 })
  })
  it('skips rows with a null score', () => {
    expect(mapRecentMatches([{ ...base, score_a: null }], 'me')).toEqual([])
  })
})

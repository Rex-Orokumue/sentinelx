import { describe, it, expect } from 'vitest'
import { deriveTournamentResults, type TournamentResultInput } from './tournament-results'
import type { BracketMatch } from '@/lib/tournaments/bracket'

function finalMatch(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 'm1', round: 'final', group_id: null, groupName: null, status: 'completed',
    score_a: 2, score_b: 0, scheduled_at: null, is_full_day: false,
    playerA: { id: 'p1', name: 'Champ' }, playerB: { id: 'p2', name: 'Runner' },
    ...overrides,
  }
}

const base: TournamentResultInput = {
  tournamentId: 't1', slug: 'august-masters', title: 'August 2026 Masters',
  prizePool: 10000, tournamentEnd: '2026-08-30T00:00:00Z', finalMatch: finalMatch(),
}

describe('deriveTournamentResults', () => {
  it('pairs a champion with a runner-up', () => {
    const [r] = deriveTournamentResults([base])
    expect(r.champion).toEqual({ id: 'p1', name: 'Champ' })
    expect(r.runnerUp).toEqual({ id: 'p2', name: 'Runner' })
  })
  it('skips a tournament with no final yet', () => {
    expect(deriveTournamentResults([{ ...base, finalMatch: null }])).toEqual([])
  })
  it('orders most-recent-first, nulls last', () => {
    const older = { ...base, tournamentId: 't0', tournamentEnd: '2026-07-01T00:00:00Z' }
    const [first, second] = deriveTournamentResults([older, base])
    expect(first.tournamentId).toBe('t1')
    expect(second.tournamentId).toBe('t0')
  })
})

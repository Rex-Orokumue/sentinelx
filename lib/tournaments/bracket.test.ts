import { describe, it, expect } from 'vitest'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  type BracketMatch,
} from './bracket'

function match(over: Partial<BracketMatch> & { id: string }): BracketMatch {
  return {
    round: 'group',
    group_id: 'g1',
    groupName: 'Group A',
    status: 'scheduled',
    score_a: null,
    score_b: null,
    scheduled_at: null,
    playerA: { id: 'pa', name: 'A' },
    playerB: { id: 'pb', name: 'B' },
    ...over,
  }
}

describe('splitFixturesByState', () => {
  it('buckets by status and puts disputed + cancelled together', () => {
    const res = splitFixturesByState([
      match({ id: '1', status: 'live' }),
      match({ id: '2', status: 'scheduled' }),
      match({ id: '3', status: 'completed' }),
      match({ id: '4', status: 'disputed' }),
      match({ id: '5', status: 'cancelled' }),
    ])
    expect(res.live.map((m) => m.id)).toEqual(['1'])
    expect(res.upcoming.map((m) => m.id)).toEqual(['2'])
    expect(res.completed.map((m) => m.id)).toEqual(['3'])
    expect(res.disputedOrCancelled.map((m) => m.id)).toEqual(['4', '5'])
  })

  it('sorts upcoming by scheduled_at with nulls last', () => {
    const res = splitFixturesByState([
      match({ id: 'late', status: 'scheduled', scheduled_at: '2026-07-10T18:00:00Z' }),
      match({ id: 'none', status: 'scheduled', scheduled_at: null }),
      match({ id: 'early', status: 'scheduled', scheduled_at: '2026-07-10T15:00:00Z' }),
    ])
    expect(res.upcoming.map((m) => m.id)).toEqual(['early', 'late', 'none'])
  })
})

describe('orderKnockoutRounds', () => {
  it('returns rounds in canonical order regardless of input order, omitting empty rounds', () => {
    const rounds = orderKnockoutRounds([
      match({ id: 'f', round: 'final' }),
      match({ id: 'q1', round: 'quarter_final' }),
      match({ id: 'q2', round: 'quarter_final' }),
      match({ id: 's', round: 'semi_final' }),
    ])
    expect(rounds.map((r) => r.round)).toEqual(['quarter_final', 'semi_final', 'final'])
    expect(rounds[0].label).toBe('Quarter-finals')
    expect(rounds[0].matches.map((m) => m.id)).toEqual(['q1', 'q2'])
  })
})

describe('getChampion', () => {
  it('returns the winner of a completed final', () => {
    const champ = getChampion([
      match({
        id: 'f',
        round: 'final',
        status: 'completed',
        score_a: 3,
        score_b: 1,
        playerA: { id: 'pa', name: 'Alpha' },
        playerB: { id: 'pb', name: 'Bravo' },
      }),
    ])
    expect(champ).toEqual({ id: 'pa', name: 'Alpha' })
  })

  it('picks player B when B wins', () => {
    const champ = getChampion([
      match({ id: 'f', round: 'final', status: 'completed', score_a: 0, score_b: 2 }),
    ])
    expect(champ?.id).toBe('pb')
  })

  it('returns null when the final is not completed or absent', () => {
    expect(getChampion([match({ id: 'f', round: 'final', status: 'live', score_a: 1, score_b: 0 })])).toBeNull()
    expect(getChampion([match({ id: 's', round: 'semi_final', status: 'completed', score_a: 2, score_b: 0 })])).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  getThirdPlace,
  groupFixturesByDate,
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
    is_full_day: false,
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

describe('groupFixturesByDate', () => {
  it('groups by WAT calendar date, ascending, Date TBD last', () => {
    const groups = groupFixturesByDate([
      match({ id: 'tbd', scheduled_at: null }),
      match({ id: 'a', scheduled_at: '2026-08-02T10:00:00Z' }),
      match({ id: 'b', scheduled_at: '2026-08-01T09:00:00Z' }),
      match({ id: 'c', scheduled_at: '2026-08-01T18:00:00Z' }),
    ])
    expect(groups.map((g) => g.dateLabel)).toEqual(['1 Aug 2026', '2 Aug 2026', 'Date TBD'])
    expect(groups[0].matches.map((m) => m.id)).toEqual(['b', 'c'])
    expect(groups[1].matches.map((m) => m.id)).toEqual(['a'])
    expect(groups[2].matches.map((m) => m.id)).toEqual(['tbd'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupFixturesByDate([])).toEqual([])
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

describe('getThirdPlace', () => {
  it('returns the winner of a completed third_place match', () => {
    const winner = getThirdPlace([
      match({
        id: 'tp',
        round: 'third_place',
        status: 'completed',
        score_a: 1,
        score_b: 3,
        playerA: { id: 'pa', name: 'Alpha' },
        playerB: { id: 'pb', name: 'Bravo' },
      }),
    ])
    expect(winner).toEqual({ id: 'pb', name: 'Bravo' })
  })

  it('returns playerA for an admin-credited bye', () => {
    const winner = getThirdPlace([
      match({
        id: 'tp',
        round: 'third_place',
        status: 'bye',
        score_a: null,
        score_b: null,
        playerA: { id: 'pa', name: 'Alpha' },
        playerB: { id: '', name: 'TBD' },
      }),
    ])
    expect(winner).toEqual({ id: 'pa', name: 'Alpha' })
  })

  it('returns null when not completed/bye, absent, or drawn', () => {
    expect(
      getThirdPlace([match({ id: 'tp', round: 'third_place', status: 'scheduled' })]),
    ).toBeNull()
    expect(
      getThirdPlace([match({ id: 'f', round: 'final', status: 'completed', score_a: 2, score_b: 0 })]),
    ).toBeNull()
    expect(
      getThirdPlace([
        match({ id: 'tp', round: 'third_place', status: 'completed', score_a: 1, score_b: 1 }),
      ]),
    ).toBeNull()
  })
})

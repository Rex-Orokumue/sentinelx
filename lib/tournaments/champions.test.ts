import { describe, it, expect } from 'vitest'
import { headToHeadWinner, type H2HMatch } from './champions'

const m = (a: string, b: string, sa: number, sb: number): H2HMatch => ({
  playerAId: a, playerBId: b, scoreA: sa, scoreB: sb, status: 'completed',
})

describe('headToHeadWinner', () => {
  it('gives it to whoever won the meeting', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 2, 1)])).toBe('x')
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 2)])).toBe('y')
  })

  it('reads the fixture from either side', () => {
    expect(headToHeadWinner('x', 'y', [m('y', 'x', 3, 0)])).toBe('y')
  })

  it('aggregates multiple meetings on points', () => {
    // x won one, y won one, and the third was drawn -> level on points,
    // separated below by goal difference.
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 3, 0), m('y', 'x', 1, 0), m('x', 'y', 2, 2)])).toBe('x')
  })

  it('falls to head-to-head goal difference when points are level', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 3, 0), m('y', 'x', 1, 0)])).toBe('x')
  })

  it('returns null when they are completely level', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 1, 1)])).toBeNull()
    expect(headToHeadWinner('x', 'y', [m('x', 'y', 2, 0), m('y', 'x', 2, 0)])).toBeNull()
  })

  it('returns null when they never met', () => {
    expect(headToHeadWinner('x', 'y', [m('x', 'z', 5, 0)])).toBeNull()
  })

  it('ignores matches that are not completed or have no score', () => {
    expect(headToHeadWinner('x', 'y', [{ ...m('x', 'y', 3, 0), status: 'scheduled' }])).toBeNull()
    expect(headToHeadWinner('x', 'y', [{ ...m('x', 'y', 0, 0), scoreA: null }])).toBeNull()
  })
})

// ── Champion resolution ───────────────────────────────────────────────
import { resolveChampion } from './champions'
import type { BracketMatch } from './bracket'
import type { MembershipInput } from './standings'

const finalMatch = (sa: number, sb: number, status = 'completed'): BracketMatch => ({
  id: 'f1',
  round: 'final',
  group_id: null,
  groupName: null,
  status,
  score_a: sa,
  score_b: sb,
  scheduled_at: null,
  is_full_day: false,
  playerA: { id: 'x', name: 'X' },
  playerB: { id: 'y', name: 'Y' },
})

const member = (id: string, w: number, d: number, l: number, gf: number, ga: number): MembershipInput => ({
  playerId: id,
  name: id.toUpperCase(),
  wins: w,
  draws: d,
  losses: l,
  goalsFor: gf,
  goalsAgainst: ga,
  points: w * 3 + d,
})

describe('resolveChampion — knockout final', () => {
  it('crowns the winner of a completed final and names the runner-up', () => {
    const r = resolveChampion({ bracketMatches: [finalMatch(4, 2)] })
    expect(r?.champion.id).toBe('x')
    expect(r?.runnerUp?.id).toBe('y')
  })

  it('is undecided when the final is drawn', () => {
    expect(resolveChampion({ bracketMatches: [finalMatch(2, 2)] })).toBeNull()
  })

  it('is undecided when the final is not completed', () => {
    expect(resolveChampion({ bracketMatches: [finalMatch(4, 2, 'scheduled')] })).toBeNull()
  })

  it('does not crown the group leader while an undecided final exists', () => {
    const standings = [member('a', 3, 0, 0, 9, 1), member('b', 1, 0, 2, 3, 6)]
    expect(resolveChampion({ bracketMatches: [finalMatch(0, 0, 'scheduled')], standings })).toBeNull()
  })
})

describe('resolveChampion — round robin', () => {
  it('crowns the top of the league table', () => {
    const standings = [member('a', 3, 0, 0, 9, 1), member('b', 1, 0, 2, 3, 6)]
    const r = resolveChampion({ bracketMatches: [], standings })
    expect(r?.champion.id).toBe('a')
    expect(r?.runnerUp?.id).toBe('b')
  })

  it('uses head-to-head when the top two are level on every standings tiebreak', () => {
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    const h2h: H2HMatch[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 2, scoreB: 0, status: 'completed' },
    ]
    const r = resolveChampion({ bracketMatches: [], standings, h2hMatches: h2h })
    expect(r?.champion.id).toBe('a')
    expect(r?.runnerUp?.id).toBe('b')
  })

  it('crowns the head-to-head winner even when standings order put them second', () => {
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    const h2h: H2HMatch[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 0, scoreB: 3, status: 'completed' },
    ]
    const r = resolveChampion({ bracketMatches: [], standings, h2hMatches: h2h })
    expect(r?.champion.id).toBe('b')
    expect(r?.runnerUp?.id).toBe('a')
  })

  it('is undecided on a dead tie with no head-to-head separation', () => {
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    const h2h: H2HMatch[] = [
      { playerAId: 'a', playerBId: 'b', scoreA: 1, scoreB: 1, status: 'completed' },
    ]
    expect(resolveChampion({ bracketMatches: [], standings, h2hMatches: h2h })).toBeNull()
  })

  it('is undecided on a dead tie when they never met', () => {
    const standings = [member('a', 2, 0, 1, 5, 3), member('b', 2, 0, 1, 5, 3)]
    expect(resolveChampion({ bracketMatches: [], standings, h2hMatches: [] })).toBeNull()
  })

  it('crowns a sole entrant with no runner-up', () => {
    const r = resolveChampion({ bracketMatches: [], standings: [member('a', 1, 0, 0, 2, 0)] })
    expect(r?.champion.id).toBe('a')
    expect(r?.runnerUp).toBeNull()
  })

  it('is undecided with neither a final nor standings', () => {
    expect(resolveChampion({ bracketMatches: [] })).toBeNull()
  })
})

// ── Entries and selectors ─────────────────────────────────────────────
import { groupByType, latestChampion, reigningChampionByGame, type ChampionEntry } from './champions'

const entry = (over: Partial<ChampionEntry>): ChampionEntry => ({
  tournamentId: 't1',
  slug: 't-1',
  title: 'T1',
  tournamentType: 'open',
  gameId: 'g1',
  gameName: 'DLS',
  date: '2026-01-01T00:00:00Z',
  prizePool: 1000,
  champion: { id: 'p1', name: 'P1' },
  runnerUp: null,
  championAvatarUrl: null,
  ...over,
})

describe('groupByType', () => {
  it('buckets every entry under its own type', () => {
    const g = groupByType([
      entry({ tournamentId: 'a', tournamentType: 'open' }),
      entry({ tournamentId: 'b', tournamentType: 'masters' }),
      entry({ tournamentId: 'c', tournamentType: 'open' }),
    ])
    expect(g.open.map((e) => e.tournamentId)).toEqual(['a', 'c'])
    expect(g.masters).toHaveLength(1)
  })

  it('always returns a bucket for every type, so a section can check length safely', () => {
    const g = groupByType([])
    expect(g.open).toEqual([])
    expect(g.masters).toEqual([])
    expect(g.community_club).toEqual([])
    expect(g.champions_cup).toEqual([])
  })
})

describe('latestChampion', () => {
  it('picks the most recent by date', () => {
    const r = latestChampion([
      entry({ tournamentId: 'old', date: '2026-01-01T00:00:00Z' }),
      entry({ tournamentId: 'new', date: '2026-06-01T00:00:00Z' }),
    ])
    expect(r?.tournamentId).toBe('new')
  })

  it('returns null for no entries', () => {
    expect(latestChampion([])).toBeNull()
  })

  it('ignores entries with no date rather than ranking them first', () => {
    const r = latestChampion([entry({ tournamentId: 'undated', date: null }), entry({ tournamentId: 'dated' })])
    expect(r?.tournamentId).toBe('dated')
  })
})

describe('reigningChampionByGame', () => {
  it('keeps only the most recent champion per game', () => {
    const map = reigningChampionByGame([
      entry({ tournamentId: 'dls-old', gameId: 'g1', date: '2026-01-01T00:00:00Z' }),
      entry({ tournamentId: 'dls-new', gameId: 'g1', date: '2026-05-01T00:00:00Z' }),
      entry({ tournamentId: 'fc', gameId: 'g2', date: '2026-03-01T00:00:00Z' }),
    ])
    expect(map.get('g1')?.tournamentId).toBe('dls-new')
    expect(map.get('g2')?.tournamentId).toBe('fc')
    expect(map.size).toBe(2)
  })
})

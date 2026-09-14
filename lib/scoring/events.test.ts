import { describe, it, expect } from 'vitest'
import { matchEventsFor, teamMatchEventsFor } from './events'

const base = {
  id: 'm1',
  player_a_id: 'A',
  player_b_id: 'B',
  score_a: 3,
  score_b: 1,
  status: 'completed',
  resolution: null,
}

describe('matchEventsFor', () => {
  it('gives both players match_completed and the winner win_no_dispute', () => {
    const events = matchEventsFor(base)
    expect(events).toHaveLength(3)
    expect(events.filter((e) => e.player_id === 'A')).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null },
      { player_id: 'A', match_id: 'm1', event_type: 'win_no_dispute', points_delta: 90, note: null },
    ])
    expect(events.filter((e) => e.player_id === 'B')).toEqual([
      { player_id: 'B', match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null },
    ])
  })

  it('awards win_no_dispute to player B when B wins', () => {
    const events = matchEventsFor({ ...base, score_a: 0, score_b: 2 })
    const wins = events.filter((e) => e.event_type === 'win_no_dispute')
    expect(wins).toHaveLength(1)
    expect(wins[0].player_id).toBe('B')
  })

  it('gives no win bonus on a draw', () => {
    const events = matchEventsFor({ ...base, score_a: 1, score_b: 1 })
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.event_type === 'match_completed')).toBe(true)
  })

  it('returns nothing for a non-completed match', () => {
    expect(matchEventsFor({ ...base, status: 'scheduled' })).toEqual([])
    expect(matchEventsFor({ ...base, status: 'disputed' })).toEqual([])
  })

  it('returns nothing for a bye or missing scores', () => {
    expect(matchEventsFor({ ...base, status: 'bye', player_b_id: null, score_a: null, score_b: null })).toEqual([])
    expect(matchEventsFor({ ...base, score_b: null })).toEqual([])
  })

  it('a decisive win totals 100 and a loss totals 10 across both events', () => {
    const events = matchEventsFor({
      id: 'm1', player_a_id: 'a', player_b_id: 'b',
      score_a: 3, score_b: 1, status: 'completed', resolution: null,
    })
    const totalFor = (playerId: string) =>
      events.filter((e) => e.player_id === playerId).reduce((s, e) => s + e.points_delta, 0)
    expect(totalFor('a')).toBe(100)
    expect(totalFor('b')).toBe(10)
  })
})

describe('matchEventsFor — no-show resolutions', () => {
  it('gives a walkover winner match_completed only, and the loser no_show only', () => {
    const events = matchEventsFor({ ...base, resolution: 'walkover', score_a: 3, score_b: 0 })
    expect(events).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null },
      { player_id: 'B', match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null },
    ])
  })

  it('gives both players no_show on a group no_show_draw', () => {
    const events = matchEventsFor({ ...base, resolution: 'no_show_draw', score_a: 0, score_b: 0 })
    expect(events).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null },
      { player_id: 'B', match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null },
    ])
  })

  it('gives both players no_show on a knockout forfeit, with no score required', () => {
    const events = matchEventsFor({ ...base, status: 'forfeited', score_a: null, score_b: null })
    expect(events).toEqual([
      { player_id: 'A', match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null },
      { player_id: 'B', match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null },
    ])
  })

  it('returns nothing for a forfeit missing a player (defensive)', () => {
    expect(matchEventsFor({ ...base, status: 'forfeited', player_b_id: null })).toEqual([])
  })
})

const teamBase = {
  id: 'm1',
  team_a_id: 'sqA',
  team_b_id: 'sqB',
  score_a: 4,
  score_b: 2,
  status: 'completed',
  resolution: null,
}
const rosterA = ['a1', 'a2']
const rosterB = ['b1', 'b2']
const allCheckedIn = new Set([...rosterA, ...rosterB])

describe('teamMatchEventsFor — normal completion', () => {
  it('gives every checked-in roster member match_completed, and the winning side win_no_dispute too', () => {
    const events = teamMatchEventsFor(teamBase, rosterA, rosterB, allCheckedIn)
    expect(events).toHaveLength(6) // 4x match_completed + 2x win_no_dispute
    for (const pid of rosterA) {
      expect(events).toContainEqual({ player_id: pid, match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null })
      expect(events).toContainEqual({ player_id: pid, match_id: 'm1', event_type: 'win_no_dispute', points_delta: 90, note: null })
    }
    for (const pid of rosterB) {
      expect(events).toContainEqual({ player_id: pid, match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null })
      expect(events.filter((e) => e.player_id === pid && e.event_type === 'win_no_dispute')).toHaveLength(0)
    }
  })

  it('no-shows a roster member individually who never checked in, even though their team completed the match', () => {
    const checkedIn = new Set(['a1', 'a2', 'b1']) // b2 never checked in
    const events = teamMatchEventsFor(teamBase, rosterA, rosterB, checkedIn)
    expect(events).toContainEqual({ player_id: 'b2', match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null })
    expect(events.filter((e) => e.player_id === 'b2')).toHaveLength(1) // no_show only, no match_completed
    expect(events).toContainEqual({ player_id: 'b1', match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null })
  })

  it('gives no win bonus on a draw, still gates match_completed on check-in', () => {
    const events = teamMatchEventsFor({ ...teamBase, score_a: 2, score_b: 2 }, rosterA, rosterB, allCheckedIn)
    expect(events).toHaveLength(4)
    expect(events.every((e) => e.event_type === 'match_completed')).toBe(true)
  })
})

describe('teamMatchEventsFor — no-show resolutions', () => {
  it('credits every present-side member and no-shows every absent-side member on a walkover', () => {
    const events = teamMatchEventsFor({ ...teamBase, resolution: 'walkover', score_a: 1, score_b: 0 }, rosterA, rosterB, new Set())
    expect(events).toHaveLength(4)
    for (const pid of rosterA) expect(events).toContainEqual({ player_id: pid, match_id: 'm1', event_type: 'match_completed', points_delta: 10, note: null })
    for (const pid of rosterB) expect(events).toContainEqual({ player_id: pid, match_id: 'm1', event_type: 'no_show', points_delta: -100, note: null })
  })

  it('no-shows every roster member on both sides for a mutual no_show_draw', () => {
    const events = teamMatchEventsFor({ ...teamBase, resolution: 'no_show_draw', score_a: 0, score_b: 0 }, rosterA, rosterB, new Set())
    expect(events).toHaveLength(4)
    expect(events.every((e) => e.event_type === 'no_show')).toBe(true)
  })

  it('no-shows every roster member on both sides for a knockout forfeit, with no score required', () => {
    const events = teamMatchEventsFor({ ...teamBase, status: 'forfeited', score_a: null, score_b: null }, rosterA, rosterB, new Set())
    expect(events).toHaveLength(4)
    expect(events.every((e) => e.event_type === 'no_show')).toBe(true)
  })

  it('returns nothing for a non-completed, non-forfeited match', () => {
    expect(teamMatchEventsFor({ ...teamBase, status: 'scheduled' }, rosterA, rosterB, allCheckedIn)).toEqual([])
  })

  it('returns nothing for a bye or missing team ids/scores', () => {
    expect(teamMatchEventsFor({ ...teamBase, team_b_id: null, score_b: null }, rosterA, [], allCheckedIn)).toEqual([])
  })
})

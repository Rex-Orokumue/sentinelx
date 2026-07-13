import { describe, it, expect } from 'vitest'
import { friendlyMatchEventsFor, type FriendlyMatchInput } from './scoring'

function m(over: Partial<FriendlyMatchInput>): FriendlyMatchInput {
  return {
    id: 'fm1',
    challengerId: 'a',
    opponentId: 'b',
    scoreChallenger: 3,
    scoreOpponent: 1,
    winnerId: 'a',
    ...over,
  }
}

describe('friendlyMatchEventsFor', () => {
  it('credits match_completed to both players', () => {
    const events = friendlyMatchEventsFor(m({}))
    const types = events.filter((e) => e.event_type === 'match_completed').map((e) => e.player_id)
    expect(types.sort()).toEqual(['a', 'b'])
  })

  it('credits win_no_dispute to the winner only', () => {
    const events = friendlyMatchEventsFor(m({}))
    const winEvents = events.filter((e) => e.event_type === 'win_no_dispute')
    expect(winEvents).toEqual([
      { player_id: 'a', match_id: null, event_type: 'win_no_dispute', points_delta: 1, note: 'Staked friendly match fm1' },
    ])
  })

  it('uses null match_id and a note referencing the friendly match id', () => {
    const events = friendlyMatchEventsFor(m({}))
    expect(events.every((e) => e.match_id === null)).toBe(true)
    expect(events.every((e) => e.note === 'Staked friendly match fm1')).toBe(true)
  })

  it('awards no win event when there is no winner (should not happen for a completed staked friendly, but must not crash)', () => {
    const events = friendlyMatchEventsFor(m({ winnerId: null }))
    expect(events.filter((e) => e.event_type === 'win_no_dispute')).toEqual([])
    expect(events).toHaveLength(2)
  })
})

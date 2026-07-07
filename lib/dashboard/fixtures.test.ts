import { describe, it, expect } from 'vitest'
import { bucketFixtures, type DashboardMatchInput } from './fixtures'

const NOW = new Date('2026-07-07T12:00:00Z')

function m(over: Partial<DashboardMatchInput> & { id: string }): DashboardMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    round: 'group',
    opponentName: 'Opp',
    tournamentTitle: 'Cup',
    tournamentSlug: 'cup',
    ...over,
  }
}

describe('bucketFixtures — bucketing', () => {
  it('splits by status into live / upcoming / completed', () => {
    const r = bucketFixtures(
      [
        m({ id: 'l', status: 'live' }),
        m({ id: 'u', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' }),
        m({ id: 'c', status: 'completed' }),
        m({ id: 'x', status: 'cancelled' }),
      ],
      new Set(),
      NOW,
    )
    expect(r.live.map((f) => f.id)).toEqual(['l'])
    expect(r.upcoming.map((f) => f.id)).toEqual(['u'])
    expect(r.completed.map((f) => f.id).sort()).toEqual(['c', 'x'])
  })

  it('sorts upcoming ascending and completed descending by scheduledAt, nulls last', () => {
    const r = bucketFixtures(
      [
        m({ id: 'u2', status: 'scheduled', scheduledAt: '2026-09-01T10:00:00Z' }),
        m({ id: 'u1', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' }),
        m({ id: 'unull', status: 'scheduled', scheduledAt: null }),
        m({ id: 'c1', status: 'completed', scheduledAt: '2026-05-01T10:00:00Z' }),
        m({ id: 'c2', status: 'completed', scheduledAt: '2026-06-01T10:00:00Z' }),
      ],
      new Set(),
      NOW,
    )
    expect(r.upcoming.map((f) => f.id)).toEqual(['u1', 'u2', 'unull'])
    expect(r.completed.map((f) => f.id)).toEqual(['c2', 'c1'])
  })
})

describe('bucketFixtures — awaitingMyResult', () => {
  it('does NOT flag a future scheduled match', () => {
    const r = bucketFixtures(
      [m({ id: 'f', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].awaitingMyResult).toBe(false)
  })

  it('flags a past unplayed scheduled match with no submission', () => {
    const r = bucketFixtures(
      [m({ id: 'p', status: 'scheduled', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].awaitingMyResult).toBe(true)
  })

  it('does NOT flag a match the player already submitted', () => {
    const r = bucketFixtures(
      [m({ id: 'p', status: 'scheduled', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(['p']),
      NOW,
    )
    expect(r.upcoming[0].awaitingMyResult).toBe(false)
  })

  it('flags a live match regardless of scheduledAt', () => {
    const r = bucketFixtures([m({ id: 'l', status: 'live', scheduledAt: null })], new Set(), NOW)
    expect(r.live[0].awaitingMyResult).toBe(true)
  })

  it('does NOT flag a scheduled match with a null scheduledAt', () => {
    const r = bucketFixtures([m({ id: 'n', status: 'scheduled', scheduledAt: null })], new Set(), NOW)
    expect(r.upcoming[0].awaitingMyResult).toBe(false)
  })

  it('does NOT flag a completed match', () => {
    const r = bucketFixtures(
      [m({ id: 'c', status: 'completed', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.completed[0].awaitingMyResult).toBe(false)
  })

  it('does NOT flag a bye row even if its scheduledAt is in the past', () => {
    const r = bucketFixtures(
      [m({ id: 'b', status: 'bye', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.completed[0].awaitingMyResult).toBe(false)
  })
})

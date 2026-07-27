import { describe, it, expect } from 'vitest'
import {
  bucketFixtures,
  groupFixturesByDate,
  isTournamentPublished,
  toWhatsAppNumber,
  buildOpponentWhatsAppUrl,
  type DashboardMatchInput,
} from './fixtures'

const NOW = new Date('2026-07-07T12:00:00Z')

function m(over: Partial<DashboardMatchInput> & { id: string }): DashboardMatchInput {
  return {
    status: 'scheduled',
    scheduledAt: null,
    isFullDay: false,
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

describe('bucketFixtures — matchDayReached', () => {
  it('is true once scheduledAt has passed', () => {
    const r = bucketFixtures(
      [m({ id: 'p', status: 'scheduled', scheduledAt: '2026-07-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].matchDayReached).toBe(true)
  })

  it('is false for a future scheduledAt', () => {
    const r = bucketFixtures(
      [m({ id: 'f', status: 'scheduled', scheduledAt: '2026-08-01T10:00:00Z' })],
      new Set(),
      NOW,
    )
    expect(r.upcoming[0].matchDayReached).toBe(false)
  })

  it('is false for a null scheduledAt', () => {
    const r = bucketFixtures([m({ id: 'n', status: 'scheduled', scheduledAt: null })], new Set(), NOW)
    expect(r.upcoming[0].matchDayReached).toBe(false)
  })
})

describe('groupFixturesByDate', () => {
  it('groups fixtures by WAT calendar date, ascending', () => {
    const r = bucketFixtures(
      [
        m({ id: 'a', scheduledAt: '2026-08-02T10:00:00Z' }),
        m({ id: 'b', scheduledAt: '2026-08-01T09:00:00Z' }),
        m({ id: 'c', scheduledAt: '2026-08-01T18:00:00Z' }),
      ],
      new Set(),
      NOW,
    )
    const groups = groupFixturesByDate(r.upcoming)
    expect(groups.map((g) => g.dateLabel)).toEqual(['1 Aug 2026', '2 Aug 2026'])
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(['b', 'c'])
    expect(groups[1].fixtures.map((f) => f.id)).toEqual(['a'])
  })

  it('puts a Date TBD group last regardless of input order', () => {
    const r = bucketFixtures(
      [
        m({ id: 'tbd', scheduledAt: null }),
        m({ id: 'dated', scheduledAt: '2026-08-01T09:00:00Z' }),
      ],
      new Set(),
      NOW,
    )
    const groups = groupFixturesByDate(r.upcoming)
    expect(groups.map((g) => g.dateLabel)).toEqual(['1 Aug 2026', 'Date TBD'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupFixturesByDate([])).toEqual([])
  })
})

describe('isTournamentPublished', () => {
  it('hides a generated-but-unpublished bracket (registration_closed preview)', () => {
    expect(isTournamentPublished('registration_closed')).toBe(false)
  })
  it('hides tournaments with no bracket yet', () => {
    expect(isTournamentPublished('draft')).toBe(false)
    expect(isTournamentPublished('registration_open')).toBe(false)
  })
  it('shows an active tournament', () => {
    expect(isTournamentPublished('active')).toBe(true)
  })
  it('shows a completed tournament', () => {
    expect(isTournamentPublished('completed')).toBe(true)
  })
  it('hides when the tournament reference is missing', () => {
    expect(isTournamentPublished(null)).toBe(false)
    expect(isTournamentPublished(undefined)).toBe(false)
  })
})

describe('toWhatsAppNumber', () => {
  it('converts a local 0-prefixed Nigerian number to international format', () => {
    expect(toWhatsAppNumber('08012345678')).toBe('2348012345678')
  })

  it('accepts an already-international number with a leading +', () => {
    expect(toWhatsAppNumber('+2348012345678')).toBe('2348012345678')
  })

  it('accepts an already-international number with no +', () => {
    expect(toWhatsAppNumber('2348012345678')).toBe('2348012345678')
  })

  it('accepts a 10-digit number missing the leading 0', () => {
    expect(toWhatsAppNumber('8012345678')).toBe('2348012345678')
  })

  it('strips spaces and dashes before formatting', () => {
    expect(toWhatsAppNumber('080 123-45678')).toBe('2348012345678')
  })

  it('returns null for an unrecognized length', () => {
    expect(toWhatsAppNumber('12345')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(toWhatsAppNumber('')).toBeNull()
  })
})

describe('buildOpponentWhatsAppUrl', () => {
  it('builds a wa.me link to the opponent with a prefilled message', () => {
    const url = buildOpponentWhatsAppUrl({
      opponentWhatsapp: '08012345678',
      opponentName: 'DarkStrikerNG',
      tournamentTitle: 'Season 3 Cup',
    })
    expect(url).not.toBeNull()
    expect(url!.startsWith('https://wa.me/2348012345678?text=')).toBe(true)
    const decoded = decodeURIComponent(url!.split('?text=')[1])
    expect(decoded).toContain('Season 3 Cup')
  })

  it('returns null when the opponent has no usable WhatsApp number', () => {
    expect(
      buildOpponentWhatsAppUrl({
        opponentWhatsapp: null,
        opponentName: 'DarkStrikerNG',
        tournamentTitle: 'Season 3 Cup',
      }),
    ).toBeNull()
  })
})

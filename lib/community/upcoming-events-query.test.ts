import { describe, it, expect } from 'vitest'
import { mapTournamentToEventItem } from './upcoming-events-query'

describe('mapTournamentToEventItem', () => {
  it('maps a registration_open tournament to a Register CTA', () => {
    const item = mapTournamentToEventItem({
      id: 't1',
      title: 'DLS Community Club #4',
      slug: 'dls-community-club-4',
      tournament_start: '2026-08-25T19:00:00Z',
      status: 'registration_open',
    })
    expect(item).toEqual({
      id: 't1',
      title: 'DLS Community Club #4',
      date: '25 Aug 2026',
      time: '25 Aug, 20:00',
      ctaLabel: 'Register',
      ctaHref: '/tournaments/dls-community-club-4',
    })
  })

  it('maps a non-registration-open tournament to a View CTA', () => {
    const item = mapTournamentToEventItem({
      id: 't2',
      title: 'Season 2 Finals',
      slug: 'season-2-finals',
      tournament_start: '2026-09-01T18:00:00Z',
      status: 'active',
    })
    expect(item.ctaLabel).toBe('View')
  })

  it('falls back to TBD copy when tournament_start is null', () => {
    const item = mapTournamentToEventItem({
      id: 't3',
      title: 'Draft Cup',
      slug: 'draft-cup',
      tournament_start: null,
      status: 'registration_open',
    })
    expect(item.date).toBe('Date TBD')
    expect(item.time).toBe('Time TBD')
  })
})

import { describe, it, expect } from 'vitest'
import { buildTournamentJsonLd, buildMatchJsonLd } from './event'
import { SITE_URL, SITE_NAME } from '../site'

describe('buildTournamentJsonLd', () => {
  it('omits endDate when tournamentEnd is null', () => {
    const result = buildTournamentJsonLd({
      title: 'DLS 26 Championship',
      slug: 'dls-26-championship',
      description: 'The season opener.',
      status: 'registration_open',
      tournamentStart: '2026-08-01T18:00:00.000Z',
      tournamentEnd: null,
      registrationFee: 500,
    })
    expect(result.startDate).toBe('2026-08-01T18:00:00.000Z')
    expect(result).not.toHaveProperty('endDate')
  })

  it('includes endDate when set, and never duplicates startDate into it', () => {
    const result = buildTournamentJsonLd({
      title: 'DLS 26 Championship',
      slug: 'dls-26-championship',
      description: 'The season opener.',
      status: 'completed',
      tournamentStart: '2026-08-01T18:00:00.000Z',
      tournamentEnd: '2026-08-15T20:00:00.000Z',
      registrationFee: 500,
    })
    expect(result.startDate).toBe('2026-08-01T18:00:00.000Z')
    expect(result.endDate).toBe('2026-08-15T20:00:00.000Z')
    expect(result.endDate).not.toBe(result.startDate)
  })

  it('prices the offer in NGN and links to the tournament url', () => {
    const result = buildTournamentJsonLd({
      title: 'DLS 26 Championship',
      slug: 'dls-26-championship',
      description: null,
      status: 'active',
      tournamentStart: null,
      tournamentEnd: null,
      registrationFee: 750,
    })
    expect(result.offers).toMatchObject({ price: 750, priceCurrency: 'NGN' })
    expect(result.url).toBe(`${SITE_URL}/tournaments/dls-26-championship`)
    expect(result.organizer).toMatchObject({ name: SITE_NAME })
  })
})

describe('buildMatchJsonLd', () => {
  it('names the match after both players and links the tournament as superEvent', () => {
    const result = buildMatchJsonLd({
      id: 'match-1',
      playerAName: 'SniperKing',
      playerBName: 'GoalMachine',
      status: 'completed',
      scoreA: 3,
      scoreB: 1,
      tournamentTitle: 'DLS 26 Championship',
      tournamentSlug: 'dls-26-championship',
    })
    expect(result.name).toBe('SniperKing vs GoalMachine')
    expect(result.competitor).toEqual([
      { '@type': 'Person', name: 'SniperKing' },
      { '@type': 'Person', name: 'GoalMachine' },
    ])
    expect(result.superEvent).toMatchObject({ name: 'DLS 26 Championship', url: `${SITE_URL}/tournaments/dls-26-championship` })
    expect(result.description).toContain('3')
    expect(result.description).toContain('1')
  })

  it('omits superEvent and the score when the match has no tournament or result yet', () => {
    const result = buildMatchJsonLd({
      id: 'match-2',
      playerAName: 'SniperKing',
      playerBName: 'GoalMachine',
      status: 'scheduled',
      scoreA: null,
      scoreB: null,
      tournamentTitle: null,
      tournamentSlug: null,
    })
    expect(result).not.toHaveProperty('superEvent')
    expect(result.description).toBe('SniperKing vs GoalMachine')
  })
})

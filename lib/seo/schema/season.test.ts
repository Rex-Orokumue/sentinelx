import { describe, it, expect } from 'vitest'
import { buildSeasonJsonLd } from './season'
import { SITE_URL, SITE_NAME } from '../site'

describe('buildSeasonJsonLd', () => {
  it('builds an EventSeries with the season url, dates, and organizer', () => {
    const result = buildSeasonJsonLd({
      name: 'Season 3',
      slug: 'season-3',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
    })
    expect(result).toEqual({
      '@context': 'https://schema.org',
      '@type': 'EventSeries',
      name: 'Season 3',
      description: "Season 3 on Sentinel X — tournaments across every game, and the road to the top of each leaderboard.",
      url: `${SITE_URL}/seasons/season-3`,
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    })
  })
})

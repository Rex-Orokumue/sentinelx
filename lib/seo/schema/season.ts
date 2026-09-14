import { SITE_URL, SITE_NAME } from '../site'

export type SeasonEventSeriesInput = {
  name: string
  slug: string
  startDate: string
  endDate: string
}

export function buildSeasonJsonLd(s: SeasonEventSeriesInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'EventSeries',
    name: s.name,
    description: `${s.name} on Sentinel X — tournaments across every game, and the road to the top of each leaderboard.`,
    url: `${SITE_URL}/seasons/${s.slug}`,
    startDate: s.startDate,
    endDate: s.endDate,
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }
}

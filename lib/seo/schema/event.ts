import { SITE_URL, SITE_NAME } from '../site'

export type TournamentEventInput = {
  title: string
  slug: string
  description: string | null
  status: string
  tournamentStart: string | null
  tournamentEnd: string | null
  registrationFee: number
}

export function buildTournamentJsonLd(t: TournamentEventInput) {
  const url = `${SITE_URL}/tournaments/${t.slug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: t.title,
    description: t.description ?? `${t.title} on Sentinel X.`,
    url,
    ...(t.tournamentStart ? { startDate: t.tournamentStart } : {}),
    ...(t.tournamentEnd ? { endDate: t.tournamentEnd } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    offers: {
      '@type': 'Offer',
      price: t.registrationFee,
      priceCurrency: 'NGN',
      url,
      availability: 'https://schema.org/InStock',
    },
  }
}

export type MatchEventInput = {
  id: string
  playerAName: string
  playerBName: string
  status: string
  scoreA: number | null
  scoreB: number | null
  tournamentTitle: string | null
  tournamentSlug: string | null
}

export function buildMatchJsonLd(m: MatchEventInput) {
  const url = `${SITE_URL}/matches/${m.id}`
  const name = `${m.playerAName} vs ${m.playerBName}`
  const completed = m.status === 'completed' && m.scoreA != null && m.scoreB != null
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name,
    url,
    competitor: [
      { '@type': 'Person', name: m.playerAName },
      { '@type': 'Person', name: m.playerBName },
    ],
    ...(m.tournamentTitle && m.tournamentSlug
      ? {
          superEvent: {
            '@type': 'SportsEvent',
            name: m.tournamentTitle,
            url: `${SITE_URL}/tournaments/${m.tournamentSlug}`,
          },
        }
      : {}),
    description: completed ? `${name} — final score ${m.scoreA}–${m.scoreB}.` : name,
  }
}

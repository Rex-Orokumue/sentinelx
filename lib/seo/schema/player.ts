import { SITE_URL } from '../site'

export type PlayerProfileInput = {
  username: string
  displayName: string | null
  wins: number
  totalMatches: number
  sentinelScore: number
  sentinelTier: string | null
}

export function buildPlayerJsonLd(p: PlayerProfileInput) {
  const name = p.displayName ?? p.username
  const url = `${SITE_URL}/players/${p.username}`
  const tierText = p.sentinelTier ? ` (${p.sentinelTier} tier)` : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name,
      alternateName: p.username,
      url,
      description: `${name} on Sentinel X — ${p.wins} wins from ${p.totalMatches} matches, Sentinel Score ${p.sentinelScore}${tierText}.`,
    },
  }
}

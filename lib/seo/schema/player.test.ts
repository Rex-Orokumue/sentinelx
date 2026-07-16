import { describe, it, expect } from 'vitest'
import { buildPlayerJsonLd } from './player'
import { SITE_URL } from '../site'

describe('buildPlayerJsonLd', () => {
  it('puts quantified stats into the description, not interactionStatistic', () => {
    const result = buildPlayerJsonLd({
      username: 'sniperking',
      displayName: 'Sniper King',
      wins: 12,
      totalMatches: 20,
      sentinelScore: 82,
      sentinelTier: 'Trusted',
    })
    expect(result.mainEntity).not.toHaveProperty('interactionStatistic')
    expect(result.mainEntity.description).toContain('12 wins')
    expect(result.mainEntity.description).toContain('20 matches')
    expect(result.mainEntity.description).toContain('82')
    expect(result.mainEntity.description).toContain('Trusted')
    expect(result.mainEntity.url).toBe(`${SITE_URL}/players/sniperking`)
    expect(result.mainEntity.alternateName).toBe('sniperking')
  })

  it('falls back to username as the display name', () => {
    const result = buildPlayerJsonLd({
      username: 'sniperking',
      displayName: null,
      wins: 0,
      totalMatches: 0,
      sentinelScore: 70,
      sentinelTier: null,
    })
    expect(result.mainEntity.name).toBe('sniperking')
    expect(result.mainEntity.description).not.toContain('null')
  })
})

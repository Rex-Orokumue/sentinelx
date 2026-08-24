import { describe, it, expect } from 'vitest'
import { buildMetadata } from './metadata'

describe('buildMetadata', () => {
  it('includes hreflang alternates for every locale plus x-default', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/tournaments/x', locale: 'fr' })
    expect(result.alternates?.languages).toEqual({
      en: 'https://sentinelx.gg/tournaments/x',
      fr: 'https://sentinelx.gg/fr/tournaments/x',
      pcm: 'https://sentinelx.gg/pcm/tournaments/x',
      'x-default': 'https://sentinelx.gg/tournaments/x',
    })
  })

  it('canonical reflects the current locale', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/tournaments/x', locale: 'fr' })
    expect(result.alternates?.canonical).toBe('https://sentinelx.gg/fr/tournaments/x')
  })
})

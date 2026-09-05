import { describe, it, expect } from 'vitest'
import { buildMetadata } from './metadata'
import { SITE_URL } from './site'

describe('buildMetadata', () => {
  it('includes hreflang alternates for every locale plus x-default', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/tournaments/x', locale: 'fr' })
    expect(result.alternates?.languages).toEqual({
      en: `${SITE_URL}/tournaments/x`,
      fr: `${SITE_URL}/fr/tournaments/x`,
      pcm: `${SITE_URL}/pcm/tournaments/x`,
      'x-default': `${SITE_URL}/tournaments/x`,
    })
  })

  it('canonical reflects the current locale', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/tournaments/x', locale: 'fr' })
    expect(result.alternates?.canonical).toBe(`${SITE_URL}/fr/tournaments/x`)
  })
})

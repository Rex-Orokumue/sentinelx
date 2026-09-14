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

  it('sets openGraph.locale and alternateLocale for every other locale', () => {
    const result = buildMetadata({ title: 'T', description: 'D', path: '/x', locale: 'fr' })
    expect(result.openGraph?.locale).toBe('fr_FR')
    expect(result.openGraph?.alternateLocale).toEqual(['en_NG', 'pcm_NG'])
  })

  it('sets profile.username when type is profile', () => {
    const result = buildMetadata({
      title: 'T', description: 'D', path: '/players/sentinel', locale: 'en',
      type: 'profile', profileUsername: 'sentinel',
    })
    expect(result.openGraph).toMatchObject({ type: 'profile', username: 'sentinel' })
  })

  it('sets article publishedTime and authors when type is article', () => {
    const result = buildMetadata({
      title: 'T', description: 'D', path: '/community/123', locale: 'en',
      type: 'article', article: { publishedTime: '2026-09-01T00:00:00.000Z', author: 'Sentinel' },
    })
    expect(result.openGraph).toMatchObject({
      type: 'article',
      publishedTime: '2026-09-01T00:00:00.000Z',
      authors: ['Sentinel'],
    })
  })
})

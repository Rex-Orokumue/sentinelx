import { describe, it, expect } from 'vitest'
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from './site'
import { SITE_URL, SITE_NAME } from '../site'

describe('buildOrganizationJsonLd', () => {
  it('describes Sentinel X as an Organization', () => {
    const result = buildOrganizationJsonLd()
    expect(result).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo-icon.png`,
    })
  })
})

describe('buildWebsiteJsonLd', () => {
  it('describes the site as a WebSite', () => {
    const result = buildWebsiteJsonLd()
    expect(result).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
    })
  })
})

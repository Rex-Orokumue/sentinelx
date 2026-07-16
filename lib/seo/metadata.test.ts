import { describe, it, expect } from 'vitest'
import { buildMetadata } from './metadata'
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from './site'

describe('buildMetadata', () => {
  it('builds canonical url, OG, and twitter fields from path', () => {
    const result = buildMetadata({
      title: 'Rankings — Sentinel X',
      description: "Nigeria's top mobile esports players.",
      path: '/rankings',
    })
    expect(result.title).toBe('Rankings — Sentinel X')
    expect(result.alternates).toEqual({ canonical: `${SITE_URL}/rankings` })
    expect(result.openGraph).toMatchObject({
      title: 'Rankings — Sentinel X',
      description: "Nigeria's top mobile esports players.",
      url: `${SITE_URL}/rankings`,
      siteName: SITE_NAME,
      type: 'website',
      images: [DEFAULT_OG_IMAGE],
    })
    expect(result.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Rankings — Sentinel X',
      images: [DEFAULT_OG_IMAGE],
    })
  })

  it('uses an explicit image over the default', () => {
    const result = buildMetadata({
      title: 'DLS 26 Championship',
      description: 'Prize pool and registration.',
      path: '/tournaments/dls-26-championship',
      image: 'https://example.com/banner.png',
    })
    expect(result.openGraph?.images).toEqual(['https://example.com/banner.png'])
    expect(result.twitter?.images).toEqual(['https://example.com/banner.png'])
  })

  it('defaults type to website but allows override', () => {
    const result = buildMetadata({
      title: 'A post',
      description: 'desc',
      path: '/community',
      type: 'article',
    })
    expect(result.openGraph?.type).toBe('article')
  })
})

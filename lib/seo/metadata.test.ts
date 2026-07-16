import { describe, it, expect } from 'vitest'
import { buildMetadata } from './metadata'
import { SITE_URL, SITE_NAME } from './site'

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
    })
    expect(result.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Rankings — Sentinel X',
    })
  })

  it('omits images when none is given, so Next\'s opengraph-image file convention can fill it in', () => {
    const result = buildMetadata({
      title: 'Rankings — Sentinel X',
      description: "Nigeria's top mobile esports players.",
      path: '/rankings',
    })
    expect(result.openGraph).not.toHaveProperty('images')
    expect(result.twitter).not.toHaveProperty('images')
  })

  it('uses an explicit image when given', () => {
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
    expect((result.openGraph as { type?: string } | null)?.type).toBe('article')
  })
})

import { describe, it, expect } from 'vitest'
import { buildBreadcrumbJsonLd } from './breadcrumb'
import { SITE_URL } from '../site'

describe('buildBreadcrumbJsonLd', () => {
  it('numbers items starting at 1 and builds absolute urls', () => {
    const result = buildBreadcrumbJsonLd([
      { name: 'Tournaments', path: '/tournaments' },
      { name: 'DLS 26 Championship', path: '/tournaments/dls-26-championship' },
    ])
    expect(result['@type']).toBe('BreadcrumbList')
    expect(result.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Tournaments', item: `${SITE_URL}/tournaments` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'DLS 26 Championship',
        item: `${SITE_URL}/tournaments/dls-26-championship`,
      },
    ])
  })
})

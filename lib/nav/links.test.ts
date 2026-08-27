import { describe, it, expect } from 'vitest'
import {
  mergeNavLinks,
  SHEET_SITE_LINKS,
  NAVBAR_LINKS,
  NAVBAR_PRIMARY_LINKS,
  NAVBAR_MORE_LINKS,
  PILLAR_LINKS,
  type NavLink,
} from './links'

describe('mergeNavLinks', () => {
  it('keeps every link from the first list, in order', () => {
    const a: NavLink[] = [{ href: '/a', labelKey: 'A' }, { href: '/b', labelKey: 'B' }]
    expect(mergeNavLinks(a, [])).toEqual(a)
  })

  it('appends links from later lists whose href is not already present', () => {
    const a: NavLink[] = [{ href: '/a', labelKey: 'A' }]
    const b: NavLink[] = [{ href: '/b', labelKey: 'B' }]
    expect(mergeNavLinks(a, b)).toEqual([
      { href: '/a', labelKey: 'A' },
      { href: '/b', labelKey: 'B' },
    ])
  })

  it('drops a later-list link whose href already appeared, keeping the first occurrence', () => {
    const a: NavLink[] = [{ href: '/shared', labelKey: 'First label' }]
    const b: NavLink[] = [{ href: '/shared', labelKey: 'Second label' }, { href: '/only-b', labelKey: 'Only B' }]
    expect(mergeNavLinks(a, b)).toEqual([
      { href: '/shared', labelKey: 'First label' },
      { href: '/only-b', labelKey: 'Only B' },
    ])
  })

  it('merges three or more lists', () => {
    const a: NavLink[] = [{ href: '/a', labelKey: 'A' }]
    const b: NavLink[] = [{ href: '/a', labelKey: 'A dup' }, { href: '/b', labelKey: 'B' }]
    const c: NavLink[] = [{ href: '/c', labelKey: 'C' }]
    expect(mergeNavLinks(a, b, c)).toEqual([
      { href: '/a', labelKey: 'A' },
      { href: '/b', labelKey: 'B' },
      { href: '/c', labelKey: 'C' },
    ])
  })
})

describe('SHEET_SITE_LINKS', () => {
  it('includes /tv, the gap BottomTabBar used to be the only way to reach', () => {
    expect(SHEET_SITE_LINKS.some((l) => l.href === '/tv')).toBe(true)
  })

  it('has no duplicate hrefs', () => {
    const hrefs = SHEET_SITE_LINKS.map((l) => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('contains every NAVBAR_LINKS entry', () => {
    for (const link of NAVBAR_LINKS) {
      expect(SHEET_SITE_LINKS).toContainEqual(link)
    }
  })

  it('contains every PILLAR_LINKS entry (by href — PillarLink carries an extra `key` field NavLink does not)', () => {
    for (const pillar of PILLAR_LINKS) {
      expect(SHEET_SITE_LINKS.some((l) => l.href === pillar.href && l.labelKey === pillar.labelKey)).toBe(true)
    }
  })

  it('leads with Home, from NAVBAR_LINKS', () => {
    expect(SHEET_SITE_LINKS[0]).toEqual({ href: '/', labelKey: 'home' })
  })
})

describe('NAVBAR_PRIMARY_LINKS / NAVBAR_MORE_LINKS', () => {
  it('together contain exactly the same links as NAVBAR_LINKS, no more, no fewer', () => {
    const combined = [...NAVBAR_PRIMARY_LINKS, ...NAVBAR_MORE_LINKS]
    expect(combined).toHaveLength(NAVBAR_LINKS.length)
    for (const link of NAVBAR_LINKS) {
      expect(combined).toContainEqual(link)
    }
  })

  it('have no overlap with each other', () => {
    const primaryHrefs = new Set(NAVBAR_PRIMARY_LINKS.map((l) => l.href))
    for (const link of NAVBAR_MORE_LINKS) {
      expect(primaryHrefs.has(link.href)).toBe(false)
    }
  })

  it('keeps the primary row short enough to fit alongside the account cluster (5 items)', () => {
    expect(NAVBAR_PRIMARY_LINKS.length).toBeLessThanOrEqual(5)
  })

  it('primary row leads with Home', () => {
    expect(NAVBAR_PRIMARY_LINKS[0]).toEqual({ href: '/', labelKey: 'home' })
  })
})

import { describe, it, expect } from 'vitest'
import { mergeNavLinks, SHEET_SITE_LINKS, NAVBAR_LINKS, PILLAR_LINKS, type NavLink } from './links'

describe('mergeNavLinks', () => {
  it('keeps every link from the first list, in order', () => {
    const a: NavLink[] = [{ href: '/a', label: 'A' }, { href: '/b', label: 'B' }]
    expect(mergeNavLinks(a, [])).toEqual(a)
  })

  it('appends links from later lists whose href is not already present', () => {
    const a: NavLink[] = [{ href: '/a', label: 'A' }]
    const b: NavLink[] = [{ href: '/b', label: 'B' }]
    expect(mergeNavLinks(a, b)).toEqual([
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B' },
    ])
  })

  it('drops a later-list link whose href already appeared, keeping the first occurrence', () => {
    const a: NavLink[] = [{ href: '/shared', label: 'First label' }]
    const b: NavLink[] = [{ href: '/shared', label: 'Second label' }, { href: '/only-b', label: 'Only B' }]
    expect(mergeNavLinks(a, b)).toEqual([
      { href: '/shared', label: 'First label' },
      { href: '/only-b', label: 'Only B' },
    ])
  })

  it('merges three or more lists', () => {
    const a: NavLink[] = [{ href: '/a', label: 'A' }]
    const b: NavLink[] = [{ href: '/a', label: 'A dup' }, { href: '/b', label: 'B' }]
    const c: NavLink[] = [{ href: '/c', label: 'C' }]
    expect(mergeNavLinks(a, b, c)).toEqual([
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B' },
      { href: '/c', label: 'C' },
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
      expect(SHEET_SITE_LINKS.some((l) => l.href === pillar.href && l.label === pillar.label)).toBe(true)
    }
  })

  it('leads with Home, from NAVBAR_LINKS', () => {
    expect(SHEET_SITE_LINKS[0]).toEqual({ href: '/', label: 'Home' })
  })
})

import { describe, it, expect } from 'vitest'
import { visibleNav, isAdminNavActive, type AdminNavItem } from './nav'

const items: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
  { label: 'Results', href: '/admin/results', adminOnly: false },
]

describe('visibleNav', () => {
  it('hides adminOnly items from a moderator', () => {
    expect(visibleNav(items, false).map((i) => i.label)).toEqual(['Overview', 'Results'])
  })

  it('shows all items to an admin', () => {
    expect(visibleNav(items, true).map((i) => i.label)).toEqual([
      'Overview',
      'Withdrawals',
      'Results',
    ])
  })

  it('preserves original order', () => {
    expect(visibleNav(items, true)).toEqual(items)
  })
})

describe('isAdminNavActive', () => {
  it('marks Overview (/admin) active only on an exact match, never on subpages', () => {
    expect(isAdminNavActive('/admin', '/admin')).toBe(true)
    expect(isAdminNavActive('/admin', '/admin/tournaments')).toBe(false)
    expect(isAdminNavActive('/admin', '/admin/results')).toBe(false)
  })

  it('marks a subpage item active on exact match and nested routes', () => {
    expect(isAdminNavActive('/admin/tournaments', '/admin/tournaments')).toBe(true)
    expect(isAdminNavActive('/admin/tournaments', '/admin/tournaments/abc-123/edit')).toBe(true)
  })

  it('does not mark a subpage item active on an unrelated route', () => {
    expect(isAdminNavActive('/admin/tournaments', '/admin/results')).toBe(false)
    expect(isAdminNavActive('/admin/tournaments', '/admin')).toBe(false)
  })
})

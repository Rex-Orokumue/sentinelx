import { describe, it, expect } from 'vitest'
import { visibleNav, type AdminNavItem } from './nav'

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

import { describe, it, expect } from 'vitest'
import { DASHBOARD_NAV_ITEMS, isDashboardNavActive } from './nav'

describe('DASHBOARD_NAV_ITEMS', () => {
  it('orders Friendlies early (3rd) so it stays visible on the mobile tab row', () => {
    expect(DASHBOARD_NAV_ITEMS[2].href).toBe('/dashboard/friendlies')
  })
  it('every item has a unique href', () => {
    const hrefs = DASHBOARD_NAV_ITEMS.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe('isDashboardNavActive', () => {
  const overview = { label: 'Overview', href: '/dashboard' }
  const matches = { label: 'My Matches', href: '/dashboard/matches' }
  const friendlies = { label: 'Friendlies', href: '/dashboard/friendlies' }

  it('Overview is active only on the exact /dashboard path', () => {
    expect(isDashboardNavActive(overview, '/dashboard')).toBe(true)
    expect(isDashboardNavActive(overview, '/dashboard/matches')).toBe(false)
  })
  it('a subpage is active on its own path and any nested path beneath it', () => {
    expect(isDashboardNavActive(matches, '/dashboard/matches')).toBe(true)
    expect(isDashboardNavActive(friendlies, '/dashboard/friendlies/abc123')).toBe(true)
  })
  it('a subpage is not active on an unrelated path', () => {
    expect(isDashboardNavActive(matches, '/dashboard/tournaments')).toBe(false)
  })
})

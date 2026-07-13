export interface AdminNavItem {
  label: string
  href: string
  adminOnly: boolean
}

// Nav lists only built pages. Later admin sub-projects append their entry here.
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Community', href: '/admin/community', adminOnly: false },
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
  { label: 'Referrals', href: '/admin/referrals', adminOnly: true },
  { label: 'Friendlies', href: '/admin/friendlies', adminOnly: true },
  { label: 'Friendly withdrawals', href: '/admin/friendly-withdrawals', adminOnly: true },
]

// Returns items in original order, dropping adminOnly items for non-admins.
export function visibleNav(items: AdminNavItem[], isAdmin: boolean): AdminNavItem[] {
  return items.filter((item) => isAdmin || !item.adminOnly)
}

// Overview's href ('/admin') is a prefix of every other admin route, so it
// needs an exact match — otherwise it reads as "active" on every admin page.
// Every other item keeps prefix matching for its own nested routes (e.g.
// '/admin/tournaments/[id]/edit' under the Tournaments tab).
export function isAdminNavActive(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

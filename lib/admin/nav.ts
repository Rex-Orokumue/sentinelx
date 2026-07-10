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
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
]

// Returns items in original order, dropping adminOnly items for non-admins.
export function visibleNav(items: AdminNavItem[], isAdmin: boolean): AdminNavItem[] {
  return items.filter((item) => isAdmin || !item.adminOnly)
}

export interface AdminNavItem {
  label: string
  href: string
  adminOnly: boolean
}

// Nav lists only built pages. Later admin sub-projects append their entry here.
export const ADMIN_NAV: AdminNavItem[] = [{ label: 'Overview', href: '/admin', adminOnly: false }]

// Returns items in original order, dropping adminOnly items for non-admins.
export function visibleNav(items: AdminNavItem[], isAdmin: boolean): AdminNavItem[] {
  return items.filter((item) => isAdmin || !item.adminOnly)
}

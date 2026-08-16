export interface DashboardNavItem {
  label: string
  href: string
}

// Friendlies is 3rd (not last) so it isn't scrolled out of view on the
// mobile horizontal tab row — see plan Global Constraints.
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'My Matches', href: '/dashboard/matches' },
  { label: 'Friendlies', href: '/dashboard/friendlies' },
  { label: 'My Tournaments', href: '/dashboard/tournaments' },
  { label: 'Marketplace', href: '/dashboard/marketplace' },
  { label: 'Friends', href: '/dashboard/friends' },
  { label: 'Referrals', href: '/dashboard/referrals' },
  { label: 'Settings', href: '/dashboard/settings' },
]

// '/dashboard' is a literal prefix of every other item's href, so Overview
// needs an exact match — otherwise it would show active on every dashboard
// subpage simultaneously with that subpage's own nav item.
export function isDashboardNavActive(item: DashboardNavItem, pathname: string): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard'
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

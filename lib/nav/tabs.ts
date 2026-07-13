export interface TabDef {
  key: string
  label: string
  href: string
  // For coming-soon tabs: the ?feature= value that marks this tab active. Else null.
  feature: string | null
  // For real-page tabs: the pathname prefix that marks this tab active. Else null.
  match: string | null
}

// The four product pillars. The Account tab is auth-dependent and handled in the component.
export const PILLAR_TABS: TabDef[] = [
  { key: 'compete', label: 'Compete', href: '/tournaments', feature: null, match: '/tournaments' },
  { key: 'watch', label: 'Watch', href: '/tv', feature: null, match: '/tv' },
  { key: 'community', label: 'Community', href: '/community', feature: null, match: '/community' },
  { key: 'trade', label: 'Trade', href: '/exchange', feature: null, match: '/exchange' },
]

export function isTabActive(
  tab: { feature: string | null; match: string | null },
  pathname: string,
  feature: string | null,
): boolean {
  if (tab.match) return pathname === tab.match || pathname.startsWith(`${tab.match}/`)
  if (tab.feature) return pathname === '/coming-soon' && feature === tab.feature
  return false
}

export function initialsFrom(displayName: string | null, username: string | null): string {
  const source = (displayName ?? username ?? '').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

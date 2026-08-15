export interface NavLink {
  href: string
  label: string
}

export interface PillarLink extends NavLink {
  // Icon lookup key for the mobile bottom bar.
  key: string
}

// The four product pillars (CLAUDE.md). These are the mobile bottom-bar tabs
// and lead the desktop header. Labels here are the ONLY labels for these
// destinations — previously the header said "Store"/"Tournaments" while the
// bottom bar said "Trade"/"Compete" for the same pages.
export const PILLAR_LINKS: PillarLink[] = [
  { key: 'compete', href: '/tournaments', label: 'Tournaments' },
  { key: 'watch', href: '/tv', label: 'TV' },
  { key: 'community', href: '/community', label: 'Community' },
  { key: 'trade', href: '/exchange', label: 'Exchange' },
]

// Secondary destinations that earn a slot in the desktop header.
export const SECONDARY_LINKS: NavLink[] = [
  { href: '/games', label: 'Games' },
  { href: '/rankings', label: 'Leaderboards' },
  { href: '/seasons/season-1', label: 'Seasons' },
  { href: '/about', label: 'About' },
  { href: '/betting', label: 'Betting' },
]

// Reachable from the footer only — too many for the header, and the mobile
// bottom bar is capped at the four pillars + Account.
export const FOOTER_ONLY_LINKS: NavLink[] = [
  { href: '/players', label: 'Players' },
  { href: '/hall-of-fame', label: 'Hall of Fame' },
]

// Desktop header, in order. The logo is the Home link, so '/' is not repeated.
export const HEADER_LINKS: NavLink[] = [...PILLAR_LINKS, ...SECONDARY_LINKS]

// The Phase 1 visual-overhaul Navbar (see docs/superpowers visual-overhaul spec §2.1)
// shows a tighter, mockup-exact link set — including Home as its own item — rather
// than every secondary destination HEADER_LINKS carries. The mockup itself only
// covers Home/Tournaments/Games/Leaderboards/Store/Community/About — it's a style
// reference, not an exhaustive page list, so real destinations the mockup doesn't
// show (Seasons) are kept in the nav rather than dropped. /tv, /betting,
// /hall-of-fame and /players stay reachable from the footer (see FOOTER_SECTIONS
// below, which SiteFooter's expanded variant renders).
// '/exchange' was originally labeled "Store" per the Phase 1 mockup's own
// terminology, colliding with the new /store (SX Coins cosmetics store,
// Task 5.1, Phase 2 Economy). Renamed to "Exchange" (matching PILLAR_LINKS,
// which already calls it that) so /store can carry the plain "Store" label.
export const NAVBAR_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/games', label: 'Games' },
  { href: '/rankings', label: 'Leaderboards' },
  { href: '/seasons/season-1', label: 'Seasons' },
  { href: '/exchange', label: 'Exchange' },
  { href: '/store', label: 'Store' },
  { href: '/community', label: 'Community' },
  { href: '/about', label: 'About Us' },
]

// The footer is the one surface that renders every destination on every
// breakpoint — it's what makes /tv reachable on desktop and /rankings,
// /games, /about reachable on mobile.
export const FOOTER_SECTIONS: { heading: string; links: NavLink[] }[] = [
  { heading: 'Compete', links: [PILLAR_LINKS[0], SECONDARY_LINKS[1], SECONDARY_LINKS[2], FOOTER_ONLY_LINKS[1]] },
  { heading: 'Explore', links: [PILLAR_LINKS[1], PILLAR_LINKS[2], PILLAR_LINKS[3]] },
  { heading: 'More', links: [SECONDARY_LINKS[0], FOOTER_ONLY_LINKS[0], SECONDARY_LINKS[3], SECONDARY_LINKS[4]] },
]

// Deduped, ordered merge of any number of NavLink lists — first occurrence
// of each href wins, in that link's own list's order. Used to build the
// mobile nav sheet's Site section from NAVBAR_LINKS ∪ PILLAR_LINKS without
// dropping /tv, which today only appears in PILLAR_LINKS.
export function mergeNavLinks(...lists: NavLink[][]): NavLink[] {
  const seen = new Set<string>()
  const merged: NavLink[] = []
  for (const list of lists) {
    for (const link of list) {
      if (seen.has(link.href)) continue
      seen.add(link.href)
      merged.push(link)
    }
  }
  return merged
}

// The mobile nav sheet's Site section (components/shared/MobileNavSheet.tsx).
// NAVBAR_LINKS first so Home leads; PILLAR_LINKS only contributes /tv, since
// Tournaments/Community/Exchange already appear in NAVBAR_LINKS with the
// same labels.
export const SHEET_SITE_LINKS: NavLink[] = mergeNavLinks(NAVBAR_LINKS, PILLAR_LINKS)

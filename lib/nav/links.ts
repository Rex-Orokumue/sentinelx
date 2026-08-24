export interface NavLink {
  href: string
  labelKey: string
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
  { key: 'compete', href: '/tournaments', labelKey: 'tournaments' },
  { key: 'watch', href: '/tv', labelKey: 'tv' },
  { key: 'community', href: '/community', labelKey: 'community' },
  { key: 'trade', href: '/exchange', labelKey: 'exchange' },
]

// Secondary destinations that earn a slot in the desktop header.
export const SECONDARY_LINKS: NavLink[] = [
  { href: '/games', labelKey: 'games' },
  { href: '/rankings', labelKey: 'rankings' },
  { href: '/seasons/season-1', labelKey: 'seasons' },
  { href: '/about', labelKey: 'about' },
]

// Reachable from the footer only — too many for the header, and the mobile
// bottom bar is capped at the four pillars + Account.
export const FOOTER_ONLY_LINKS: NavLink[] = [
  { href: '/players', labelKey: 'players' },
  { href: '/hall-of-fame', labelKey: 'hallOfFame' },
]

// Desktop header, in order. The logo is the Home link, so '/' is not repeated.
export const HEADER_LINKS: NavLink[] = [...PILLAR_LINKS, ...SECONDARY_LINKS]

// The Phase 1 visual-overhaul Navbar (see docs/superpowers visual-overhaul spec §2.1)
// shows a tighter, mockup-exact link set — including Home as its own item — rather
// than every secondary destination HEADER_LINKS carries. The mockup itself only
// covers Home/Tournaments/Games/Leaderboards/Store/Community/About — it's a style
// reference, not an exhaustive page list, so real destinations the mockup doesn't
// show (Seasons) are kept in the nav rather than dropped. /tv, /hall-of-fame
// and /players stay reachable from the footer (see FOOTER_SECTIONS below,
// which SiteFooter's expanded variant renders).
// '/exchange' was originally labeled "Store" per the Phase 1 mockup's own
// terminology, colliding with the new /store (SX Coins cosmetics store,
// Task 5.1, Phase 2 Economy). Renamed to "Exchange" (matching PILLAR_LINKS,
// which already calls it that) so /store can carry the plain "Store" label.
export const NAVBAR_LINKS: NavLink[] = [
  { href: '/', labelKey: 'home' },
  { href: '/tournaments', labelKey: 'tournaments' },
  { href: '/games', labelKey: 'games' },
  { href: '/rankings', labelKey: 'rankings' },
  { href: '/seasons/season-1', labelKey: 'seasons' },
  { href: '/exchange', labelKey: 'exchange' },
  { href: '/store', labelKey: 'store' },
  { href: '/community', labelKey: 'community' },
  { href: '/about', labelKey: 'about' },
]

// The footer is a separate, independent data source (components/shared/SiteFooter.tsx)
// and does not consume this export — kept only as a pre-existing structural
// reference; not rendered anywhere.
export const FOOTER_SECTIONS: { heading: string; links: NavLink[] }[] = [
  { heading: 'Compete', links: [PILLAR_LINKS[0], SECONDARY_LINKS[1], SECONDARY_LINKS[2], FOOTER_ONLY_LINKS[1]] },
  { heading: 'Explore', links: [PILLAR_LINKS[1], PILLAR_LINKS[2], PILLAR_LINKS[3]] },
  { heading: 'More', links: [SECONDARY_LINKS[0], FOOTER_ONLY_LINKS[0], SECONDARY_LINKS[3]] },
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

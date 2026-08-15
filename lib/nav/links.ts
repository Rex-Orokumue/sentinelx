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
// Note: '/exchange' below is labeled "Store" per the Phase 1 mockup's own
// terminology (see comment above) — that's the Gaming Exchange, not the SX
// Coins cosmetics store. To avoid two nav items both reading "Store", the
// new /store destination (Task 5.1, Phase 2 Economy) is labeled "Coin Store".
export const NAVBAR_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/games', label: 'Games' },
  { href: '/rankings', label: 'Leaderboards' },
  { href: '/seasons/season-1', label: 'Seasons' },
  { href: '/exchange', label: 'Store' },
  { href: '/store', label: 'Coin Store' },
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

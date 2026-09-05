export interface ExchangeSubNavItem {
  href: string
  // Key under the `exchangeNav` message namespace.
  labelKey: string
}

// The Gaming Exchange section bar. Orders and the escrow explainer live
// outside /exchange but belong to the section as a destination, so they sit
// here rather than sending people back through the global nav to find them.
export const EXCHANGE_SUB_NAV: ExchangeSubNavItem[] = [
  { href: '/exchange', labelKey: 'browse' },
  { href: '/exchange/new', labelKey: 'sell' },
  { href: '/dashboard/marketplace', labelKey: 'orders' },
  { href: '/escrow', labelKey: 'escrow' },
]

function matches(href: string, pathname: string): boolean {
  // The trailing-slash guard is what stops '/exchange' claiming '/exchanged'.
  return pathname === href || pathname.startsWith(`${href}/`)
}

// Most-specific match wins. '/exchange' prefix-matches '/exchange/new', so
// picking the first match would light up Browse on the sell form; the longest
// matching href is the one that actually owns the page. Routes with no entry
// of their own (a buy request) fall back to the section root, which is why
// this resolves to a single href instead of testing each item in isolation.
//
// `pathname` is expected to be locale-stripped, as returned by
// `usePathname` from `@/i18n/navigation`.
export function activeSubNavHref(pathname: string): string | null {
  let best: string | null = null
  for (const item of EXCHANGE_SUB_NAV) {
    if (matches(item.href, pathname) && (best === null || item.href.length > best.length)) {
      best = item.href
    }
  }
  return best
}

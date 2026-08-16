export interface LinkClickInfo {
  href: string
  target: string | null
  download: boolean
  ariaDisabled: boolean
  modifierOrAuxClick: boolean // ctrlKey || metaKey || shiftKey || altKey || button !== 0
}

// Should this click be handed to the transition system at all, vs left
// entirely to native browser/Next.js default behavior? Spec §4.1.
export function isInterceptableLinkClick(info: LinkClickInfo, currentOrigin: string): boolean {
  if (info.modifierOrAuxClick) return false
  if (info.download) return false
  if (info.ariaDisabled) return false
  if (info.target && info.target !== '_self') return false
  if (/^(mailto|tel|sms):/i.test(info.href)) return false

  let url: URL
  try {
    url = new URL(info.href, currentOrigin)
  } catch {
    return false
  }
  return url.origin === currentOrigin
}

// Given an intercepted, same-origin click, should the overlay actually play?
// Compared as full URL (pathname + search + hash), not just pathname — a
// query-string-only change is a real navigation (e.g. a same-page filter
// that refetches data) and must still play; a hash-only change is an
// in-page anchor scroll and must not. Spec §4.1.
export function shouldPlayTransition(fromHref: string, toHref: string, prefersReducedMotion: boolean): boolean {
  if (prefersReducedMotion) return false
  const from = new URL(fromHref)
  const to = new URL(toHref)
  if (from.href === to.href) return false
  if (from.pathname === to.pathname && from.search === to.search) return false
  return true
}

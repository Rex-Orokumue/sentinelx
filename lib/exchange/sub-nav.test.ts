import { describe, it, expect } from 'vitest'
import { EXCHANGE_SUB_NAV, activeSubNavHref } from './sub-nav'

describe('EXCHANGE_SUB_NAV', () => {
  it('leads with Browse so the section root is the first thing scanned', () => {
    expect(EXCHANGE_SUB_NAV[0].href).toBe('/exchange')
  })
})

describe('activeSubNavHref', () => {
  it('highlights Browse on the section root', () => {
    expect(activeSubNavHref('/exchange')).toBe('/exchange')
  })

  it('keeps Browse highlighted on a listing detail page', () => {
    expect(activeSubNavHref('/exchange/abc-123')).toBe('/exchange')
  })

  // The whole reason this is a function and not a startsWith in the component:
  // '/exchange' prefix-matches '/exchange/new', so a naive check lights up both.
  it('highlights Sell — not Browse — on the sell form', () => {
    expect(activeSubNavHref('/exchange/new')).toBe('/exchange/new')
  })

  it('highlights Browse on a buy request, which has no nav entry of its own', () => {
    expect(activeSubNavHref('/exchange/requests/new')).toBe('/exchange')
  })

  it('highlights My Orders on the dashboard marketplace page', () => {
    expect(activeSubNavHref('/dashboard/marketplace')).toBe('/dashboard/marketplace')
  })

  it('highlights How escrow works on the escrow explainer', () => {
    expect(activeSubNavHref('/escrow')).toBe('/escrow')
  })

  it('returns null outside every section route', () => {
    expect(activeSubNavHref('/tournaments')).toBeNull()
  })

  // '/exchanges' must not match '/exchange' — a prefix check without the
  // trailing-slash guard would treat any such route as the section root.
  it('does not treat a longer sibling segment as the section root', () => {
    expect(activeSubNavHref('/exchanged')).toBeNull()
  })
})

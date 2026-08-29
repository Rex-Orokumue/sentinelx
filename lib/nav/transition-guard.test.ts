import { describe, it, expect } from 'vitest'
import { isInterceptableLinkClick, isNavigationSettled, shouldPlayTransition, type LinkClickInfo } from './transition-guard'

const ORIGIN = 'https://sentinelxesports.vercel.app'
function baseInfo(overrides: Partial<LinkClickInfo> = {}): LinkClickInfo {
  return {
    href: `${ORIGIN}/tournaments`,
    target: null,
    download: false,
    ariaDisabled: false,
    modifierOrAuxClick: false,
    ...overrides,
  }
}

describe('isInterceptableLinkClick', () => {
  it('intercepts a plain same-origin internal link', () => {
    expect(isInterceptableLinkClick(baseInfo(), ORIGIN)).toBe(true)
  })

  it('does not intercept a different-origin link', () => {
    expect(isInterceptableLinkClick(baseInfo({ href: 'https://wa.me/1234' }), ORIGIN)).toBe(false)
  })

  it('does not intercept target=_blank', () => {
    expect(isInterceptableLinkClick(baseInfo({ target: '_blank' }), ORIGIN)).toBe(false)
  })

  it('does not intercept a download link', () => {
    expect(isInterceptableLinkClick(baseInfo({ download: true }), ORIGIN)).toBe(false)
  })

  it('does not intercept an aria-disabled link', () => {
    expect(isInterceptableLinkClick(baseInfo({ ariaDisabled: true }), ORIGIN)).toBe(false)
  })

  it('does not intercept a modifier-key or auxiliary-button click', () => {
    expect(isInterceptableLinkClick(baseInfo({ modifierOrAuxClick: true }), ORIGIN)).toBe(false)
  })

  it('does not intercept mailto:/tel:/sms: links', () => {
    expect(isInterceptableLinkClick(baseInfo({ href: 'mailto:hi@sentinelx.gg' }), ORIGIN)).toBe(false)
    expect(isInterceptableLinkClick(baseInfo({ href: 'tel:+2348000000000' }), ORIGIN)).toBe(false)
  })

  it('does not intercept a javascript: URL (resolves to a non-matching origin)', () => {
    expect(isInterceptableLinkClick(baseInfo({ href: 'javascript:void(0)' }), ORIGIN)).toBe(false)
  })

  it('treats target="_self" as interceptable', () => {
    expect(isInterceptableLinkClick(baseInfo({ target: '_self' }), ORIGIN)).toBe(true)
  })
})

describe('shouldPlayTransition', () => {
  const FROM = `${ORIGIN}/tournaments`

  it('plays for a genuinely different destination', () => {
    expect(shouldPlayTransition(FROM, `${ORIGIN}/community`, false)).toBe(true)
  })

  it('does not play for an identical URL (clicking the page you are already on)', () => {
    expect(shouldPlayTransition(FROM, FROM, false)).toBe(false)
  })

  it('plays when only the query string changes — a same-page data refetch', () => {
    expect(shouldPlayTransition(FROM, `${ORIGIN}/tournaments?status=open`, false)).toBe(true)
  })

  it('does not play for a hash-only difference — an in-page anchor scroll', () => {
    expect(shouldPlayTransition(`${ORIGIN}/about#faq`, `${ORIGIN}/about#team`, false)).toBe(false)
  })

  it('does not play when the user prefers reduced motion, even for a real navigation', () => {
    expect(shouldPlayTransition(FROM, `${ORIGIN}/community`, true)).toBe(false)
  })
})

describe('isNavigationSettled', () => {
  // The live route comes from usePathname() + useSearchParams().toString() —
  // the latter never carries a leading "?". The pending target is built from
  // a URL object, whose .search DOES carry the "?". The comparison must
  // survive that mismatch or the overlay hangs forever on any query-string nav.
  it('is settled when pathname and query match, target query carrying a leading "?"', () => {
    expect(
      isNavigationSettled(
        { pathname: '/rankings', search: 'game=fc-mobile' },
        { pathname: '/rankings', search: '?game=fc-mobile' },
      ),
    ).toBe(true)
  })

  it('is settled for a plain navigation with no query string on either side', () => {
    expect(
      isNavigationSettled({ pathname: '/community', search: '' }, { pathname: '/community', search: '' }),
    ).toBe(true)
  })

  it('is not settled while the pathname still differs from the target', () => {
    expect(
      isNavigationSettled({ pathname: '/tournaments', search: '' }, { pathname: '/community', search: '' }),
    ).toBe(false)
  })

  it('is not settled when the query string has not caught up to the target yet', () => {
    expect(
      isNavigationSettled(
        { pathname: '/rankings', search: '' },
        { pathname: '/rankings', search: '?game=fc-mobile' },
      ),
    ).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { resolveBackLink, type BackLink } from './back-link'

const FALLBACK: BackLink = { href: '/tournaments/cup', label: 'DLS Cup' }
const TARGETS: Record<string, BackLink> = {
  bracket: { href: '/tournaments/cup/bracket', label: 'Bracket' },
  dashboard: { href: '/dashboard', label: 'Dashboard' },
}

describe('resolveBackLink', () => {
  it('resolves a known key to its target', () => {
    expect(resolveBackLink('bracket', TARGETS, FALLBACK)).toEqual(TARGETS.bracket)
    expect(resolveBackLink('dashboard', TARGETS, FALLBACK)).toEqual(TARGETS.dashboard)
  })

  it('falls back when the key is missing (direct or shared link)', () => {
    expect(resolveBackLink(undefined, TARGETS, FALLBACK)).toEqual(FALLBACK)
  })

  it('falls back for an unknown key rather than trusting it', () => {
    expect(resolveBackLink('nope', TARGETS, FALLBACK)).toEqual(FALLBACK)
  })

  it('falls back for a raw path, never treating it as an href', () => {
    expect(resolveBackLink('https://evil.example', TARGETS, FALLBACK)).toEqual(FALLBACK)
    expect(resolveBackLink('/admin', TARGETS, FALLBACK)).toEqual(FALLBACK)
  })

  it('falls back for a repeated query param (string[])', () => {
    expect(resolveBackLink(['bracket', 'dashboard'], TARGETS, FALLBACK)).toEqual(FALLBACK)
  })
})

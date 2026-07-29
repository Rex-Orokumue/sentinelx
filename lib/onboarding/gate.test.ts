import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate, ENFORCE_PHONE_VERIFICATION } from './gate'

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: null })).toBe('/onboarding/username')
  })

  it('checks username before phone', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: '2026-07-28T00:00:00.000Z' })).toBe(
      '/onboarding/username',
    )
  })

  it('passes through when username is set (phone verification currently unenforced)', () => {
    expect(resolveOnboardingGate({ username: 'davidokafor', phoneVerifiedAt: null })).toBe(null)
  })

  it('passes through when both are set', () => {
    expect(
      resolveOnboardingGate({ username: 'davidokafor', phoneVerifiedAt: '2026-07-28T00:00:00.000Z' }),
    ).toBe(null)
  })

  // Documents current intent — flip ENFORCE_PHONE_VERIFICATION to true once
  // Meta WhatsApp is live, and restore a test asserting an unverified phone
  // routes to '/onboarding/phone' when username is set.
  it('phone verification enforcement is currently disabled', () => {
    expect(ENFORCE_PHONE_VERIFICATION).toBe(false)
  })
})

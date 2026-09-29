import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate, ENFORCE_PHONE_VERIFICATION } from './gate'

const base = { username: 'davidokafor', phoneVerifiedAt: null, profileCompletedAt: null }

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null, regardless of the other fields', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: null, profileCompletedAt: null })).toBe(
      '/onboarding/username',
    )
    expect(
      resolveOnboardingGate({
        username: null,
        phoneVerifiedAt: '2026-07-28T00:00:00.000Z',
        profileCompletedAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toBe('/onboarding/username')
  })

  it('routes to profile completion when username is set and profile is incomplete (phone verification currently unenforced)', () => {
    expect(resolveOnboardingGate(base)).toBe('/onboarding/profile')
  })

  it('passes through when username is set and profile is complete', () => {
    expect(resolveOnboardingGate({ ...base, profileCompletedAt: '2026-09-29T00:00:00.000Z' })).toBe(null)
  })

  // Documents current intent — flip ENFORCE_PHONE_VERIFICATION to true once
  // Meta WhatsApp is live, and restore a test asserting an unverified phone
  // routes to '/onboarding/phone' when username is set but phone isn't.
  it('phone verification enforcement is currently disabled', () => {
    expect(ENFORCE_PHONE_VERIFICATION).toBe(false)
  })
})

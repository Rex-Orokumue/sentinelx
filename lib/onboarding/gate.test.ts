import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate } from './gate'

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: null })).toBe('/onboarding/username')
  })

  it('routes to phone verification when username is set but phone is not verified', () => {
    expect(resolveOnboardingGate({ username: 'davidokafor', phoneVerifiedAt: null })).toBe('/onboarding/phone')
  })

  it('passes through when both are set', () => {
    expect(
      resolveOnboardingGate({ username: 'davidokafor', phoneVerifiedAt: '2026-07-28T00:00:00.000Z' }),
    ).toBe(null)
  })

  it('checks username before phone', () => {
    expect(resolveOnboardingGate({ username: null, phoneVerifiedAt: '2026-07-28T00:00:00.000Z' })).toBe(
      '/onboarding/username',
    )
  })
})

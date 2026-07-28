import { describe, it, expect } from 'vitest'
import { resolveOnboardingGate } from './gate'

describe('resolveOnboardingGate', () => {
  it('routes to username claim when username is null', () => {
    expect(resolveOnboardingGate({ username: null })).toBe('/onboarding/username')
  })

  it('passes through when username is set', () => {
    expect(resolveOnboardingGate({ username: 'davidokafor' })).toBe(null)
  })
})

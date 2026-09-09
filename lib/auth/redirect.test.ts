import { describe, it, expect } from 'vitest'
import { resolveCallbackRedirect } from './redirect'

describe('resolveCallbackRedirect', () => {
  it('sends recovery links to the reset-password page', () => {
    expect(resolveCallbackRedirect({ type: 'recovery', next: '/dashboard' })).toBe('/reset-password')
  })
  it('sends signup confirmations to next', () => {
    expect(resolveCallbackRedirect({ type: 'signup', next: '/tournaments' })).toBe('/tournaments')
  })
  it('defaults to /dashboard when next is missing', () => {
    expect(resolveCallbackRedirect({ type: 'signup', next: null })).toBe('/dashboard')
  })
  it('sends confirmed email changes back to settings', () => {
    expect(resolveCallbackRedirect({ type: 'email_change', next: null })).toBe(
      '/dashboard/settings?email=changed',
    )
  })
  it('ignores next on an email change, which the template hardcodes', () => {
    expect(resolveCallbackRedirect({ type: 'email_change', next: '/tournaments' })).toBe(
      '/dashboard/settings?email=changed',
    )
  })
  it('rejects open-redirect targets', () => {
    expect(resolveCallbackRedirect({ type: null, next: '//evil.com' })).toBe('/dashboard')
    expect(resolveCallbackRedirect({ type: null, next: 'https://evil.com' })).toBe('/dashboard')
  })
})

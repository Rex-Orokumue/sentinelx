import { describe, it, expect } from 'vitest'
import { resolveCallbackRedirect, resolveOAuthFailureRedirect } from './redirect'

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
  it('passes a link callback through to settings', () => {
    expect(
      resolveCallbackRedirect({ type: null, next: '/dashboard/settings?linked=google' }),
    ).toBe('/dashboard/settings?linked=google')
  })
  it('rejects open-redirect targets', () => {
    expect(resolveCallbackRedirect({ type: null, next: '//evil.com' })).toBe('/dashboard')
    expect(resolveCallbackRedirect({ type: null, next: 'https://evil.com' })).toBe('/dashboard')
  })
})

describe('resolveOAuthFailureRedirect', () => {
  // Someone linking Google is already signed in; /login?error=auth would read
  // as "you have been signed out" for what is usually just an account already
  // attached elsewhere.
  it('sends a failed link back to settings', () => {
    expect(resolveOAuthFailureRedirect({ intent: 'link' })).toBe('/dashboard/settings?linked=error')
  })
  it('sends a failed sign-in to login', () => {
    expect(resolveOAuthFailureRedirect({ intent: null })).toBe('/login?error=auth')
  })
})

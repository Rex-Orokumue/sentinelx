import { describe, it, expect } from 'vitest'
import { resolveRegistrationView } from './view'

const base = {
  status: 'registration_open',
  loggedIn: true,
  paidCount: 0,
  maxPlayers: 16,
  existingStatus: null as string | null,
}

describe('resolveRegistrationView', () => {
  it('guest: open tournament, not logged in', () => {
    expect(resolveRegistrationView({ ...base, loggedIn: false })).toBe('guest')
  })

  it('can_register: open, logged in, capacity, no registration', () => {
    expect(resolveRegistrationView(base)).toBe('can_register')
  })

  it('complete_payment: has a pending registration', () => {
    expect(resolveRegistrationView({ ...base, existingStatus: 'pending' })).toBe('complete_payment')
  })

  it('registered: has a paid registration (highest precedence)', () => {
    expect(resolveRegistrationView({ ...base, status: 'completed', existingStatus: 'paid' })).toBe('registered')
  })

  it('full: open but paidCount at capacity', () => {
    expect(resolveRegistrationView({ ...base, paidCount: 16 })).toBe('full')
  })

  it('closed: registration_closed or active', () => {
    expect(resolveRegistrationView({ ...base, status: 'registration_closed' })).toBe('closed')
    expect(resolveRegistrationView({ ...base, status: 'active' })).toBe('closed')
  })

  it('ended: completed tournament with no registration', () => {
    expect(resolveRegistrationView({ ...base, status: 'completed' })).toBe('ended')
  })

  it('closed takes precedence over guest for a not-open tournament', () => {
    expect(resolveRegistrationView({ ...base, status: 'active', loggedIn: false })).toBe('closed')
  })
})

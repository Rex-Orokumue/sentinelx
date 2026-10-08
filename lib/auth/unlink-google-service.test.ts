import { describe, it, expect, vi } from 'vitest'
import { performUnlinkGoogle } from './unlink-google-service'
import type { AccountAuthPort } from './account-auth-port'

const both = [
  { identityId: 'i-email', provider: 'email' },
  { identityId: 'i-google', provider: 'google' },
]
function port(over: Partial<AccountAuthPort> = {}): AccountAuthPort {
  return {
    listIdentities: vi.fn(async () => both),
    updateEmail: vi.fn(async () => null),
    unlinkIdentity: vi.fn(async () => null),
    signOutOthers: vi.fn(async () => {}),
    ...over,
  }
}
const ok = vi.fn(async () => true)

describe('performUnlinkGoogle', () => {
  it('requires a password', async () => {
    const r = await performUnlinkGoogle({ port: port(), user: { email: 'a@example.com' }, password: '', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'password_required' })
  })

  it('requires a session email', async () => {
    const r = await performUnlinkGoogle({ port: port(), user: { email: null }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'not_logged_in' })
  })

  it('rejects a wrong password before touching identities', async () => {
    const p = port()
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: vi.fn(async () => false) })
    expect(r).toEqual({ ok: false, errorCode: 'wrong_password' })
    expect(p.listIdentities).not.toHaveBeenCalled()
  })

  it('reports not_linked when Google is absent', async () => {
    const p = port({ listIdentities: vi.fn(async () => [{ identityId: 'i', provider: 'email' }, { identityId: 'j', provider: 'github' }]) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'not_linked' })
  })

  it('refuses the last identity without calling the provider', async () => {
    const p = port({ listIdentities: vi.fn(async () => [{ identityId: 'i-google', provider: 'google' }]) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'last_identity' })
    expect(p.unlinkIdentity).not.toHaveBeenCalled()
  })

  it('fails when identities cannot be listed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = port({ listIdentities: vi.fn(async () => null) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'failed' })
    spy.mockRestore()
  })

  it('maps manual_linking_disabled to unavailable and does not revoke sessions', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = port({ unlinkIdentity: vi.fn(async () => ({ code: 'manual_linking_disabled', message: 'off' })) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'unavailable' })
    expect(p.signOutOthers).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('unlinks the Google identity, then revokes other sessions', async () => {
    const order: string[] = []
    const p = port({
      unlinkIdentity: vi.fn(async () => { order.push('unlink'); return null }),
      signOutOthers: vi.fn(async () => { order.push('signOutOthers') }),
    })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: true })
    expect(p.unlinkIdentity).toHaveBeenCalledWith('i-google')
    expect(order).toEqual(['unlink', 'signOutOthers'])
  })
})

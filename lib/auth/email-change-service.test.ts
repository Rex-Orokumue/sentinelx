import { describe, it, expect, vi } from 'vitest'
import { performChangeEmail } from './email-change-service'
import type { AccountAuthPort } from './account-auth-port'

function port(over: Partial<AccountAuthPort> = {}): AccountAuthPort {
  return {
    listIdentities: vi.fn(async () => []),
    updateEmail: vi.fn(async () => null),
    unlinkIdentity: vi.fn(async () => null),
    signOutOthers: vi.fn(async () => {}),
    ...over,
  }
}
const google = [{ provider: 'google' }] as never
const withEmail = [{ provider: 'email' }] as never
const deps = (over: Partial<{ verifyPassword: (e: string, p: string) => Promise<boolean>; isBanned: (e: string) => Promise<boolean> }> = {}) => ({
  verifyPassword: vi.fn(async () => true),
  isBanned: vi.fn(async () => false),
  ...over,
})
const input = { email: 'New@Example.com', password: 'pw' }

describe('performChangeEmail', () => {
  it('requires a session email', async () => {
    const r = await performChangeEmail({ port: port(), user: { email: null }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'not_logged_in' })
  })

  it('rejects the current address regardless of case', async () => {
    const r = await performChangeEmail({ port: port(), user: { email: 'new@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'same_email' })
  })

  it('wrong password with a password identity is wrong_password', async () => {
    const r = await performChangeEmail({
      port: port(),
      user: { email: 'a@example.com', identities: withEmail },
      input,
      deps: deps({ verifyPassword: vi.fn(async () => false) }),
    })
    expect(r).toEqual({ ok: false, errorCode: 'wrong_password' })
  })

  it('wrong password without a password identity is google_only', async () => {
    const r = await performChangeEmail({
      port: port(),
      user: { email: 'a@example.com', identities: google },
      input,
      deps: deps({ verifyPassword: vi.fn(async () => false) }),
    })
    expect(r).toEqual({ ok: false, errorCode: 'google_only' })
  })

  it('a Google-only user whose reset-flow password is correct still succeeds', async () => {
    const p = port()
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: google }, input, deps: deps() })
    expect(r).toEqual({ ok: true, sentTo: 'new@example.com' })
    expect(p.updateEmail).toHaveBeenCalledWith('new@example.com')
  })

  it('blocks a banned address before asking the provider', async () => {
    const p = port()
    const r = await performChangeEmail({
      port: p,
      user: { email: 'a@example.com', identities: withEmail },
      input,
      deps: deps({ isBanned: vi.fn(async () => true) }),
    })
    expect(r).toEqual({ ok: false, errorCode: 'email_banned' })
    expect(p.updateEmail).not.toHaveBeenCalled()
  })

  it('treats a send rate limit as already sent', async () => {
    const p = port({ updateEmail: vi.fn(async () => ({ code: 'over_email_send_rate_limit', message: 'slow' })) })
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: true, sentTo: 'new@example.com' })
  })

  it.each([
    [{ code: 'email_exists', message: 'x' }],
    [{ code: null, message: 'A user has already been registered' }],
  ])('maps a taken address to email_in_use (%o)', async (err) => {
    const p = port({ updateEmail: vi.fn(async () => err) })
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'email_in_use' })
  })

  it('maps any other provider failure to failed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = port({ updateEmail: vi.fn(async () => ({ code: 'unexpected', message: 'boom' })) })
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'failed' })
    spy.mockRestore()
  })
})

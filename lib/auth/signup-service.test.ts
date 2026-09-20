import { describe, it, expect, vi } from 'vitest'
import { performSignup } from './signup-service'

function fakeAuthClient(signUpResult: { data: { user: { id: string } | null }; error: unknown }) {
  return { auth: { signUp: vi.fn().mockResolvedValue(signUpResult) } }
}

function fakeAdmin(opts: { banned?: boolean; retired?: boolean } = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn((table: string) => {
    if (table === 'banned_identifiers') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.banned ? { hash: 'x' } : null } as never) }) }) }
    if (table === 'retired_usernames') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.retired ? { username: 'x' } : null } as never) }) }) }
    if (table === 'profiles') return { update }
    throw new Error(`unexpected table ${table}`)
  })
  return { admin: { from } as never, update, updateEq }
}

const input = { username: 'newplayer', email: 'new@x.com', password: 'password123' }

describe('performSignup', () => {
  it('rejects a banned identifier without calling signUp', async () => {
    const authClient = fakeAuthClient({ data: { user: null }, error: null })
    const { admin } = fakeAdmin({ banned: true })
    const result = await performSignup(authClient as never, admin, input)
    expect(result).toEqual({ ok: false, errorCode: 'blocked_details' })
    expect(authClient.auth.signUp).not.toHaveBeenCalled()
  })

  it('rejects a retired username without calling signUp', async () => {
    const authClient = fakeAuthClient({ data: { user: null }, error: null })
    const { admin } = fakeAdmin({ retired: true })
    const result = await performSignup(authClient as never, admin, input)
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
    expect(authClient.auth.signUp).not.toHaveBeenCalled()
  })

  it('signs up, passes username (+ ref) as metadata, and seeds the locale via the service role', async () => {
    const authClient = fakeAuthClient({ data: { user: { id: 'user-1' } }, error: null })
    const { admin, update, updateEq } = fakeAdmin()
    const result = await performSignup(authClient as never, admin, { ...input, ref: 'friend1', locale: 'fr' })
    expect(result).toEqual({ ok: true })
    expect(authClient.auth.signUp).toHaveBeenCalledWith({
      email: 'new@x.com', password: 'password123',
      options: { data: { username: 'newplayer', ref: 'friend1' } },
    })
    expect(update).toHaveBeenCalledWith({ locale: 'fr' })
    expect(updateEq).toHaveBeenCalled()
  })

  it('omits ref from metadata when absent', async () => {
    const authClient = fakeAuthClient({ data: { user: { id: 'user-2' } }, error: null })
    const { admin } = fakeAdmin()
    await performSignup(authClient as never, admin, input)
    expect(authClient.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { data: { username: 'newplayer' } } }),
    )
  })

  it('defaults locale to en for a missing or unknown locale', async () => {
    const authClient = fakeAuthClient({ data: { user: { id: 'user-3' } }, error: null })
    const { admin, update } = fakeAdmin()
    await performSignup(authClient as never, admin, { ...input, locale: 'de' })
    expect(update).toHaveBeenCalledWith({ locale: 'en' })
  })

  it('maps a Supabase signUp error through mapSignupError and logs it', async () => {
    const authClient = fakeAuthClient({ data: { user: null }, error: { message: 'duplicate key value', code: '23505' } })
    const { admin, update } = fakeAdmin()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await performSignup(authClient as never, admin, input)
    expect(result).toEqual({ ok: false, errorCode: 'username_taken_go_back' })
    expect(update).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const getUserIdentities = vi.fn()
const unlinkIdentity = vi.fn()
const signOut = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser, getUserIdentities, unlinkIdentity, signOut },
  }),
}))

const verifyPassword = vi.fn()
vi.mock('./reauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reauth')>()),
  verifyPassword,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

const GOOGLE = { identity_id: 'g1', provider: 'google', identity_data: { email: 'a@gmail.com' } }
const EMAIL = { identity_id: 'e1', provider: 'email', identity_data: { email: 'a@gmail.com' } }

beforeEach(() => {
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@gmail.com' } } })
  getUserIdentities.mockReset()
  getUserIdentities.mockResolvedValue({ data: { identities: [GOOGLE, EMAIL] }, error: null })
  unlinkIdentity.mockReset()
  unlinkIdentity.mockResolvedValue({ error: null })
  signOut.mockReset()
  signOut.mockResolvedValue({ error: null })
  verifyPassword.mockReset()
  verifyPassword.mockResolvedValue(true)
})

describe('unlinkGoogle', () => {
  it('unlinks the google identity', async () => {
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(result).toEqual({ unlinked: true })
    expect(unlinkIdentity).toHaveBeenCalledWith(GOOGLE)
  })

  // Unlinking is a "lock the other person out" action. Their live session has
  // to die with the link, or the unlink does nothing until the token expires.
  it('kills every other session, keeping this one', async () => {
    const { unlinkGoogle } = await import('./identities')
    await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' })
  })

  it('revokes the sessions only after the unlink succeeds', async () => {
    unlinkIdentity.mockResolvedValue({ error: { message: 'nope' } })
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(result).toEqual({ errorCode: 'failed' })
    expect(signOut).not.toHaveBeenCalled()
  })

  // The password does double duty: it proves the session belongs to the account
  // holder, and it proves a working password exists, so removing Google cannot
  // strand them.
  it('refuses on a wrong password', async () => {
    verifyPassword.mockResolvedValue(false)
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'bad' }))
    expect(result).toEqual({ errorCode: 'wrong_password' })
    expect(unlinkIdentity).not.toHaveBeenCalled()
  })

  it('requires a password at all', async () => {
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: '' }))
    expect(result).toEqual({ errorCode: 'password_required' })
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  // Supabase refuses this too; checking locally is what lets us return a
  // translated message rather than a raw API error.
  it('refuses to remove the only way into the account', async () => {
    getUserIdentities.mockResolvedValue({ data: { identities: [GOOGLE] }, error: null })
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(result).toEqual({ errorCode: 'last_identity' })
    expect(unlinkIdentity).not.toHaveBeenCalled()
  })

  // Both endpoints sit behind the project's Manual Linking toggle. "Try again"
  // would be a lie for a configuration failure.
  it('distinguishes the manual-linking toggle being off from a transient failure', async () => {
    unlinkIdentity.mockResolvedValue({
      error: { code: 'manual_linking_disabled', message: '404: Manual linking is disabled' },
    })
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(result).toEqual({ errorCode: 'unavailable' })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('reports when there is no google identity to remove', async () => {
    getUserIdentities.mockResolvedValue({ data: { identities: [EMAIL] }, error: null })
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(result).toEqual({ errorCode: 'not_linked' })
  })

  it('refuses when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { unlinkGoogle } = await import('./identities')
    const result = await unlinkGoogle(undefined, formData({ password: 'pw' }))
    expect(result).toEqual({ errorCode: 'not_logged_in' })
    expect(verifyPassword).not.toHaveBeenCalled()
  })
})

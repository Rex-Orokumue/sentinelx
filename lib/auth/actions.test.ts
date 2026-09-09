import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
const signUp = vi.fn()
const signInWithPassword = vi.fn()
const resend = vi.fn().mockResolvedValue({ error: null })
const tokenDeleteEq = vi.fn().mockResolvedValue({ error: null })
const tokenDelete = vi.fn(() => ({ eq: tokenDeleteEq }))
const from = vi.fn((table: string) => {
  if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle }) }), update }
  if (table === 'fcm_tokens') return { delete: tokenDelete }
  return {}
})
const getUser = vi.fn()
const updateUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from,
    auth: { signUp, signInWithPassword, resend, getUser, updateUser },
  }),
}))

// changeEmail() re-checks the password through reauth's throwaway client, not
// the request-scoped one above — mocked separately so a test can say "wrong
// password" without standing up a second Supabase double.
const verifyPassword = vi.fn()
vi.mock('./reauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reauth')>()),
  verifyPassword,
}))

// signup() consults retired_usernames and banned_identifiers through the
// service-role client, which is a different client from the request-scoped one
// above — hence a separate mock. Default: nothing retired, nothing banned.
const adminMaybeSingle = vi.fn().mockResolvedValue({ data: null })
const adminFrom = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: adminMaybeSingle }) }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFrom }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const cookieGet = vi.fn()
const cookieDelete = vi.fn()
vi.mock('next/headers', () => ({
  cookies: () => ({ get: cookieGet, delete: cookieDelete }),
}))

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

beforeEach(() => {
  maybeSingle.mockClear()
  update.mockClear()
  signUp.mockReset()
  signInWithPassword.mockReset()
  resend.mockClear()
  resend.mockResolvedValue({ error: null })
  adminMaybeSingle.mockReset()
  adminMaybeSingle.mockResolvedValue({ data: null })
  getUser.mockReset()
  getUser.mockResolvedValue({
    data: { user: { id: 'u1', email: 'old@x.com', identities: [{ provider: 'email' }] } },
  })
  updateUser.mockReset()
  updateUser.mockResolvedValue({ error: null })
  verifyPassword.mockReset()
  verifyPassword.mockResolvedValue(true)
})

describe('signup blocks deleted-account identifiers', () => {
  // signup() checks banned_identifiers first, then retired_usernames, so the
  // order of these two lookups is what the mockResolvedValueOnce chains track.
  it('rejects an email whose hash is in banned_identifiers', async () => {
    adminMaybeSingle.mockResolvedValueOnce({ data: { hash: 'x' } })
    const { signup } = await import('./actions')
    const result = await signup(
      undefined,
      formData({ username: 'freehandle', email: 'cheat@x.com', password: 'password123' }),
    )
    expect(result).toEqual({ error: 'We could not create an account with those details.' })
    // Generic on purpose: a distinct message would let anyone probe the
    // blocklist for a given address.
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects a retired username', async () => {
    adminMaybeSingle
      .mockResolvedValueOnce({ data: null }) // not banned
      .mockResolvedValueOnce({ data: { username: 'sniperking' } }) // retired
    const { signup } = await import('./actions')
    const result = await signup(
      undefined,
      formData({ username: 'sniperking', email: 'new@x.com', password: 'password123' }),
    )
    expect(result).toEqual({ error: 'That username is taken — try another.' })
    expect(signUp).not.toHaveBeenCalled()
  })

  it('lets a clean signup through', async () => {
    cookieGet.mockReturnValueOnce(undefined)
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-9' } }, error: null })
    const { signup } = await import('./actions')
    const result = await signup(
      undefined,
      formData({ username: 'brandnew', email: 'ok@x.com', password: 'password123' }),
    )
    expect(result).toEqual({ success: 'check-email' })
    expect(signUp).toHaveBeenCalledOnce()
  })
})

describe('signup locale seeding', () => {
  it("writes the profile's locale from the NEXT_LOCALE cookie", async () => {
    cookieGet.mockReturnValueOnce({ value: 'fr' })
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
    const { signup } = await import('./actions')
    await signup(undefined, formData({ username: 'playerone', email: 'x@x.com', password: 'password123' }))
    expect(update).toHaveBeenCalledWith({ locale: 'fr' })
  })

  it('defaults to en when the cookie is absent or invalid', async () => {
    cookieGet.mockReturnValueOnce(undefined)
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-2' } }, error: null })
    const { signup } = await import('./actions')
    await signup(undefined, formData({ username: 'playertwo', email: 'y@y.com', password: 'password123' }))
    expect(update).toHaveBeenCalledWith({ locale: 'en' })
  })
})

describe('signup no longer claims the username up front', () => {
  it('does not read profiles to pre-check the username before signUp', async () => {
    cookieGet.mockReturnValueOnce(undefined)
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-3' } }, error: null })
    const { signup } = await import('./actions')
    await signup(undefined, formData({ username: 'somehandle', email: 'z@z.com', password: 'password123' }))
    // The username is now claimed post-confirmation at /onboarding/username,
    // so signup() must not block on a profiles lookup.
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it('still passes the desired username to signUp as metadata for the onboarding prefill', async () => {
    cookieGet.mockReturnValueOnce(undefined)
    signUp.mockResolvedValueOnce({ data: { user: { id: 'user-4' } }, error: null })
    const { signup } = await import('./actions')
    await signup(undefined, formData({ username: 'carryme', email: 'a@a.com', password: 'password123' }))
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ data: { username: 'carryme' } }) }),
    )
  })
})

describe('login surfaces an unconfirmed email distinctly', () => {
  it('flags needsConfirmation when Supabase returns email_not_confirmed', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { code: 'email_not_confirmed', message: 'Email not confirmed' } })
    const { login } = await import('./actions')
    const result = await login(undefined, formData({ email: 'u@u.com', password: 'password123' }))
    expect(result).toMatchObject({ needsConfirmation: true })
  })

  it('gives the generic message for a real bad-credentials error', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { code: 'invalid_credentials', message: 'bad' } })
    const { login } = await import('./actions')
    const result = await login(undefined, formData({ email: 'u@u.com', password: 'wrongpass1' }))
    expect(result).toEqual({ error: 'Invalid email or password.' })
  })
})

describe('resendConfirmation', () => {
  it('asks Supabase to resend the signup confirmation for a valid email', async () => {
    const { resendConfirmation } = await import('./actions')
    await resendConfirmation(undefined, formData({ email: 'Someone@Example.com' }))
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'someone@example.com' })
  })

  it('returns a neutral success message that does not confirm the account exists', async () => {
    const { resendConfirmation } = await import('./actions')
    const result = await resendConfirmation(undefined, formData({ email: 'someone@example.com' }))
    expect(result?.success).toBeTruthy()
    expect(result?.error).toBeUndefined()
  })

  it('rejects an invalid email without calling Supabase', async () => {
    const { resendConfirmation } = await import('./actions')
    const result = await resendConfirmation(undefined, formData({ email: 'not-an-email' }))
    expect(result?.error).toBeTruthy()
    expect(resend).not.toHaveBeenCalled()
  })
})

// Every device has its own FCM token, stored as its own row. Deleting by
// player_id matched all of them, so signing out on a laptop silently killed
// push on the player's phone — with no indication anything had happened, and
// no way back except finding the Settings toggle again.
describe('signOut only deregisters the device it runs on', () => {
  beforeEach(() => {
    tokenDelete.mockClear()
    tokenDeleteEq.mockClear()
    cookieDelete.mockClear()
  })

  // cookieGet is shared with the locale-seeding tests, which use
  // mockReturnValueOnce. A persistent mockReturnValue set here would leak
  // into them if the runner ever reorders files.
  afterEach(() => {
    cookieGet.mockReset()
  })

  it('deletes only this device token when the device cookie is present', async () => {
    cookieGet.mockReturnValue({ value: 'device-token-abc' })
    const { signOut } = await import('./actions')
    await signOut().catch(() => {}) // redirect() throws by design
    expect(tokenDeleteEq).toHaveBeenCalledWith('token', 'device-token-abc')
  })

  it('never deletes by player_id, which would hit every device', async () => {
    cookieGet.mockReturnValue({ value: 'device-token-abc' })
    const { signOut } = await import('./actions')
    await signOut().catch(() => {})
    const columns = tokenDeleteEq.mock.calls.map((c) => c[0])
    expect(columns).not.toContain('player_id')
  })

  // Legacy sessions registered before the cookie existed. Deleting nothing is
  // the safe branch: the next sign-in on this browser re-upserts the same
  // token under the new player (onConflict: 'token'), so it cannot leak
  // notifications to the wrong person for long — whereas deleting everything
  // is exactly the bug being fixed.
  it('deletes nothing when there is no device cookie', async () => {
    cookieGet.mockReturnValue(undefined)
    const { signOut } = await import('./actions')
    await signOut().catch(() => {})
    expect(tokenDelete).not.toHaveBeenCalled()
  })

  it('clears the device cookie so a later sign-in starts clean', async () => {
    cookieGet.mockReturnValue({ value: 'device-token-abc' })
    const { signOut } = await import('./actions')
    await signOut().catch(() => {})
    expect(cookieDelete).toHaveBeenCalled()
  })
})

describe('changeEmail', () => {
  const good = { email: 'new@x.com', password: 'password123' }

  // The action returns codes, not prose — the settings form translates them,
  // the way requestAccountDeletion's blockers are translated. Asserting codes
  // also keeps these tests from breaking every time the wording is tweaked.
  it('sends the confirmation link to the new address', async () => {
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(updateUser).toHaveBeenCalledWith({ email: 'new@x.com' })
    expect(result).toEqual({ sentTo: 'new@x.com' })
  })

  it('refuses when the current password is wrong', async () => {
    verifyPassword.mockResolvedValue(false)
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'wrong_password' })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('checks the password against the address on file, not the new one', async () => {
    const { changeEmail } = await import('./actions')
    await changeEmail(undefined, formData(good))
    expect(verifyPassword).toHaveBeenCalledWith('old@x.com', 'password123')
  })

  // Same blocklist signup enforces — otherwise changing your email is a way
  // back onto an address banned for cheating.
  it('rejects an address whose hash is in banned_identifiers', async () => {
    adminMaybeSingle.mockResolvedValueOnce({ data: { hash: 'x' } })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'email_banned' })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('sends a Google-only account to set a password first', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'old@x.com', identities: [{ provider: 'google' }] } },
    })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'google_only' })
    expect(verifyPassword).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('rejects the address the account already has, whatever its case', async () => {
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData({ ...good, email: 'OLD@x.com' }))
    expect(result).toEqual({ errorCode: 'same_email' })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('reports an address that belongs to someone else', async () => {
    updateUser.mockResolvedValue({ error: { code: 'email_exists', message: 'x' } })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'email_in_use' })
  })

  // Older Supabase builds report the duplicate in prose rather than a code.
  it('reports a duplicate reported only in the message', async () => {
    updateUser.mockResolvedValue({
      error: { message: 'A user with this email address has already been registered' },
    })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'email_in_use' })
  })

  // They asked for a link moments ago; "you are being rate limited" reads as a
  // failure for something that already succeeded. Matches resendConfirmation.
  it('treats a send rate limit as sent', async () => {
    updateUser.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', message: 'x' } })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ sentTo: 'new@x.com' })
  })

  it('falls back to a generic failure on an unexpected error', async () => {
    updateUser.mockResolvedValue({ error: { code: 'unexpected_failure', message: 'boom' } })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'failed' })
  })

  it('rejects a malformed address before any lookup', async () => {
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData({ email: 'nope', password: 'password123' }))
    expect(result).toEqual({ errorCode: 'invalid_email' })
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it('asks for the password when it was left blank', async () => {
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData({ email: 'new@x.com', password: '' }))
    expect(result).toEqual({ errorCode: 'password_required' })
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it('refuses when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { changeEmail } = await import('./actions')
    const result = await changeEmail(undefined, formData(good))
    expect(result).toEqual({ errorCode: 'not_logged_in' })
  })
})

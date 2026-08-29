import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
const signUp = vi.fn()
const signInWithPassword = vi.fn()
const resend = vi.fn().mockResolvedValue({ error: null })
const from = vi.fn((table: string) =>
  table === 'profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle }) }), update }
    : {},
)
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from, auth: { signUp, signInWithPassword, resend } }),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: () => ({ get: cookieGet }) }))

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

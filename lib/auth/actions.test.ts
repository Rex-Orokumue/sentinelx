import { describe, it, expect, vi } from 'vitest'

const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
const signUp = vi.fn()
const from = vi.fn((table: string) =>
  table === 'profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle }) }), update }
    : {},
)
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ from, auth: { signUp } }) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const cookieGet = vi.fn()
vi.mock('next/headers', () => ({ cookies: () => ({ get: cookieGet }) }))

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

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

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const rolesEq = vi.fn()
const fakeUserClient = {
  auth: { getUser },
  from: vi.fn(() => ({ select: () => ({ eq: rolesEq }) })),
}
const createClient = vi.fn(() => fakeUserClient)
vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ __admin: true }) }))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  getUser.mockReset()
  rolesEq.mockReset()
  createClient.mockClear()
})

const req = (authorization?: string) =>
  new Request('https://x.test/api/mobile/v1/chat/messages', { headers: authorization ? { authorization } : {} })

describe('strictOptionalAuth', () => {
  it('no Authorization header is signed-out (null) and never touches Supabase', async () => {
    const { strictOptionalAuth } = await import('./auth')
    expect(await strictOptionalAuth(req())).toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })
  it('a present but rejected bearer is 401, never a silent downgrade to anonymous', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } })
    const { strictOptionalAuth } = await import('./auth')
    await expect(strictOptionalAuth(req('Bearer expired'))).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
  })
  it('a present but malformed Authorization header is 401 too', async () => {
    const { strictOptionalAuth } = await import('./auth')
    await expect(strictOptionalAuth(req('Basic abc'))).rejects.toMatchObject({ status: 401 })
    await expect(strictOptionalAuth(req('Bearer'))).rejects.toMatchObject({ status: 401 })
  })
  it('a valid bearer builds the context', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    rolesEq.mockResolvedValue({ data: [] })
    const { strictOptionalAuth } = await import('./auth')
    expect(await strictOptionalAuth(req('Bearer good'))).toMatchObject({ userId: 'u1' })
  })
})

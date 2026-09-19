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
  new Request('https://x.test/api/mobile/v1/me', { headers: authorization ? { authorization } : {} })

describe('readBearer', () => {
  it('extracts the token', async () => {
    const { readBearer } = await import('./auth')
    expect(readBearer(req('Bearer abc.def'))).toBe('abc.def')
    expect(readBearer(req('bearer abc'))).toBe('abc')
  })
  it('returns null for a missing or malformed header', async () => {
    const { readBearer } = await import('./auth')
    expect(readBearer(req())).toBeNull()
    expect(readBearer(req('Basic abc'))).toBeNull()
    expect(readBearer(req('Bearer'))).toBeNull()
  })
})

describe('authenticate', () => {
  it('throws unauthorized without a token and never touches Supabase', async () => {
    const { authenticate } = await import('./auth')
    await expect(authenticate(req())).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('throws unauthorized when Supabase rejects the token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })
    const { authenticate } = await import('./auth')
    await expect(authenticate(req('Bearer bad'))).rejects.toMatchObject({ status: 401 })
  })

  it('verifies the token over the network and builds the context', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    rolesEq.mockResolvedValue({ data: [{ role: 'moderator' }, { role: 'player' }] })
    const { authenticate } = await import('./auth')
    const ctx = await authenticate(req('Bearer good'))
    expect(getUser).toHaveBeenCalledWith('good')
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer good' } } }),
    )
    expect(ctx).toMatchObject({ userId: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false })
  })

  it('marks admins', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u2', email: null } }, error: null })
    rolesEq.mockResolvedValue({ data: [{ role: 'admin' }] })
    const { authenticate } = await import('./auth')
    const ctx = await authenticate(req('Bearer t'))
    expect([ctx.isStaff, ctx.isAdmin]).toEqual([true, true])
  })
})

describe('optionalAuth', () => {
  it('returns null instead of throwing for a bad token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    const { optionalAuth } = await import('./auth')
    await expect(optionalAuth(req('Bearer expired'))).resolves.toBeNull()
  })
  it('returns null with no header', async () => {
    const { optionalAuth } = await import('./auth')
    await expect(optionalAuth(req())).resolves.toBeNull()
  })
})

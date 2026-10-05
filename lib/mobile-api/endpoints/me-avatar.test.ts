import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { performUpdateProfile } = vi.hoisted(() => ({ performUpdateProfile: vi.fn() }))
vi.mock('@/lib/profile/update-profile-service', () => ({ performUpdateProfile }))

import { updateProfileEndpoint } from './me'

const UID = '11111111-1111-1111-1111-111111111111'
const base = { displayName: 'Ada', username: '', whatsapp: '', country: '', bio: '' }
const patch = (body: unknown) =>
  updateProfileEndpoint.handler(new Request('https://x.test/api/mobile/v1/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co'
  authenticate.mockResolvedValue({ userId: UID, admin: 'admin', userClient: 'sb' })
  performUpdateProfile.mockReset().mockResolvedValue({ ok: true })
})

describe('PATCH /me/profile avatarUrl', () => {
  it('rejects an off-host avatarUrl with validation_failed and fields.avatarUrl', async () => {
    const res = await patch({ ...base, avatarUrl: 'https://evil.example/x.png' })
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error.code).toBe('validation_failed')
    expect(j.error.fields.avatarUrl).toBe('invalid_avatar_url')
    expect(performUpdateProfile).not.toHaveBeenCalled()
  })
  it('accepts the caller’s own avatar object', async () => {
    const res = await patch({ ...base, avatarUrl: `https://abc.supabase.co/storage/v1/object/public/avatars/${UID}/a.webp` })
    expect(res.status).toBe(200)
    expect(performUpdateProfile).toHaveBeenCalledTimes(1)
  })
})

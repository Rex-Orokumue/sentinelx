import { describe, it, expect, vi } from 'vitest'
import { performUpdateProfile } from './update-profile-service'

function fakeSupabase(current: { username: string | null; username_changed_at: string | null }) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current }) }) }) }) } as never
}

function fakeAdmin(opts: { updateError?: { code?: string } | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn(() => ({ eq }))
  const admin = { from: (table: string) => {
    if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
    return { update }
  } } as never
  return { admin, update, eq }
}

const baseInput = { displayName: 'New Name', username: '', whatsapp: '', country: '', bio: '' }

describe('performUpdateProfile', () => {
  it('saves display name/whatsapp/country/bio without touching username when username is blank', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performUpdateProfile(fakeSupabase({ username: 'existing', username_changed_at: null }), admin, 'u1', baseInput)
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ display_name: 'New Name', whatsapp_number: null, country: null, bio: null })
  })

  it('allows a first-time username change and stamps username_changed_at', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performUpdateProfile(fakeSupabase({ username: 'old', username_changed_at: null }), admin, 'u1', { ...baseInput, username: 'newname' })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname', username_changed_at: expect.any(String) }))
  })

  it('rejects a second username change', async () => {
    const { admin } = fakeAdmin()
    const result = await performUpdateProfile(fakeSupabase({ username: 'old', username_changed_at: '2026-01-01T00:00:00Z' }), admin, 'u1', { ...baseInput, username: 'newname' })
    expect(result).toEqual({ ok: false, errorCode: 'username_locked' })
  })

  it('maps a unique-violation on username to username_taken', async () => {
    const { admin } = fakeAdmin({ updateError: { code: '23505' } })
    const result = await performUpdateProfile(fakeSupabase({ username: 'old', username_changed_at: null }), admin, 'u1', { ...baseInput, username: 'taken' })
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('includes avatarUrl in the patch only when provided', async () => {
    const { admin, update } = fakeAdmin()
    await performUpdateProfile(fakeSupabase({ username: 'x', username_changed_at: null }), admin, 'u1', { ...baseInput, avatarUrl: 'https://cdn/a.webp' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: 'https://cdn/a.webp' }))
  })
})

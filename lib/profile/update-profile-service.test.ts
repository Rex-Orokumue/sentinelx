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

describe('performUpdateProfile — game interests and consent', () => {
  const GAME = '11111111-1111-4111-8111-111111111111'

  function fakeSupabaseWithGameInterest(opts: { upsertError?: object | null } = {}) {
    const not = vi.fn().mockResolvedValue({ error: null })
    const del = vi.fn(() => ({ eq: vi.fn(() => ({ not })) }))
    const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
    return {
      supabase: {
        from: (table: string) => {
          if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: 'x', username_changed_at: null } }) }) }) }
          if (table === 'game_interest') return { delete: del, upsert }
          throw new Error('unexpected table ' + table)
        },
      } as never,
      del,
      upsert,
    }
  }

  it('writes consent_whatsapp_updates when provided', async () => {
    const { admin, update } = fakeAdmin()
    const { supabase } = fakeSupabaseWithGameInterest()
    await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, consentWhatsappUpdates: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consent_whatsapp_updates: true }))
  })

  it('writes an explicit consent false (not omitted, not coerced)', async () => {
    const { admin, update } = fakeAdmin()
    const { supabase } = fakeSupabaseWithGameInterest()
    await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, consentWhatsappUpdates: false })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consent_whatsapp_updates: false }))
  })

  it('omits consent_whatsapp_updates from the patch entirely when not provided (old mobile clients)', async () => {
    const { admin, update } = fakeAdmin()
    await performUpdateProfile(fakeSupabase({ username: 'x', username_changed_at: null }), admin, 'u1', baseInput)
    const patch = (update.mock.calls[0] as unknown[])[0]
    expect(patch).not.toHaveProperty('consent_whatsapp_updates')
  })

  it('replaces game interests when gameInterests is provided', async () => {
    const { admin } = fakeAdmin()
    const { supabase, upsert } = fakeSupabaseWithGameInterest()
    const result = await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, gameInterests: [GAME] })
    expect(result).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith([{ user_id: 'u1', game_id: GAME }], expect.anything())
  })

  it('does not touch game_interest when gameInterests is omitted (old mobile clients)', async () => {
    const { admin } = fakeAdmin()
    // fakeSupabase's from() ignores the table name — if replaceGameInterests were called it would
    // try .upsert() on this stub and throw, since it only implements .select().
    const result = await performUpdateProfile(fakeSupabase({ username: 'x', username_changed_at: null }), admin, 'u1', baseInput)
    expect(result).toEqual({ ok: true })
  })

  it('does NOT report success when the game-interest write fails', async () => {
    const { admin } = fakeAdmin()
    const { supabase } = fakeSupabaseWithGameInterest({ upsertError: { message: 'boom' } })
    const result = await performUpdateProfile(supabase, admin, 'u1', { ...baseInput, gameInterests: [GAME] })
    expect(result).toEqual({ ok: false, errorCode: 'save_failed' })
  })
})

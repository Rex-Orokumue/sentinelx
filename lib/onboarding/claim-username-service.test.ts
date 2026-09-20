import { describe, it, expect, vi } from 'vitest'
import { performClaimUsername } from './claim-username-service'

function fakeSupabase(existing: { id: string } | null) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }) }) } as never
}

function fakeAdmin(opts: { retired?: boolean; updateError?: { code?: string } | null } = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn((table: string) => {
    if (table === 'retired_usernames') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.retired ? { username: 'x' } : null }) }) }) }
    if (table === 'profiles') return { update }
    throw new Error(`unexpected table ${table}`)
  })
  return { admin: { from } as never, update, updateEq }
}

describe('performClaimUsername', () => {
  it('rejects an invalid username without touching the database', async () => {
    const { admin } = fakeAdmin()
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'ab')
    expect(result).toEqual({ ok: false, errorCode: 'username_too_short' })
  })

  it('rejects an already-claimed username', async () => {
    const { admin } = fakeAdmin()
    const result = await performClaimUsername(fakeSupabase({ id: 'someone-else' }), admin, 'u1', 'taken')
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('rejects a retired username even though it is free in profiles', async () => {
    const { admin } = fakeAdmin({ retired: true })
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'sniperking')
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('claims a clean username via the service role', async () => {
    const { admin, update, updateEq } = fakeAdmin()
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'BrandNew')
    expect(result).toEqual({ ok: true, username: 'BrandNew' })
    expect(update).toHaveBeenCalledWith({ username: 'BrandNew', display_name: 'BrandNew' })
    expect(updateEq).toHaveBeenCalled()
  })

  it('maps a unique-violation race to username_taken', async () => {
    const { admin } = fakeAdmin({ updateError: { code: '23505' } })
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'racer')
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('maps any other update failure to username_save_failed', async () => {
    const { admin } = fakeAdmin({ updateError: { code: '500' } })
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'unlucky')
    expect(result).toEqual({ ok: false, errorCode: 'username_save_failed' })
  })
})

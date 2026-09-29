import { describe, it, expect, vi } from 'vitest'
import { performCompleteProfileOnboarding } from './profile-completion-service'

function fakeSupabase() {
  const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  const insert = vi.fn().mockResolvedValue({ error: null })
  return {
    from: (table: string) => {
      if (table !== 'game_interest') throw new Error(`unexpected table ${table}`)
      return { delete: del, insert }
    },
  } as never
}

function fakeAdmin(opts: { updateError?: object | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn(() => ({ eq }))
  return { admin: { from: (table: string) => { if (table !== 'profiles') throw new Error(`unexpected table ${table}`); return { update } } } as never, update }
}

const GAME_ID = '11111111-1111-4111-8111-111111111111'
const validInput = { country: 'Nigeria', whatsapp: '08012345678', consentWhatsappUpdates: 'true' as const, gameInterests: [GAME_ID] }

describe('performCompleteProfileOnboarding', () => {
  it('rejects an invalid submission without touching the database', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, gameInterests: [] })
    expect(result.ok).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a number that is invalid for the selected country (South African shape against Nigeria)', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, whatsapp: '0821234567' })
    expect(result).toEqual({ ok: false, errorCode: 'invalid_whatsapp' })
    expect(update).not.toHaveBeenCalled()
  })

  it('resolves a legacy free-text country ("Nigerian") via the existing alias table', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, country: 'Nigerian' })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ country: 'Nigerian', whatsapp_number: '+2348012345678' }))
  })

  it('stores E.164, stamps profile_completed_at, and replaces game interests on success', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', validInput)
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({
      country: 'Nigeria',
      whatsapp_number: '+2348012345678',
      consent_whatsapp_updates: true,
      profile_completed_at: expect.any(String),
    })
  })

  it('stores consent as false for an explicit no', async () => {
    const { admin, update } = fakeAdmin()
    await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', { ...validInput, consentWhatsappUpdates: 'false' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consent_whatsapp_updates: false }))
  })

  it('reports save_failed when the profiles update errors', async () => {
    const { admin } = fakeAdmin({ updateError: { message: 'boom' } })
    const result = await performCompleteProfileOnboarding(fakeSupabase(), admin, 'u1', validInput)
    expect(result).toEqual({ ok: false, errorCode: 'save_failed' })
  })
})

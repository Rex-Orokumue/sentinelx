import { describe, it, expect, vi } from 'vitest'
import { performCompleteProfileOnboarding } from './profile-completion-service'
import type { OnboardingProfileCore } from './profile-schema'

function fakeAdmin(rpcResult: { error: { code?: string; message: string } | null } = { error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult)
  return { admin: { rpc } as never, rpc }
}

const GAME_ID = '11111111-1111-4111-8111-111111111111'
const valid: OnboardingProfileCore = {
  country: 'Nigeria',
  whatsapp: '08012345678',
  consentWhatsappUpdates: true,
  gameInterests: [GAME_ID],
}

describe('performCompleteProfileOnboarding', () => {
  it('rejects an unrecognised country instead of silently falling back to Nigeria', async () => {
    const { admin, rpc } = fakeAdmin()
    // A perfectly valid Nigerian number paired with a country that does not exist.
    const result = await performCompleteProfileOnboarding(admin, 'u1', { ...valid, country: 'Atlantis' })
    expect(result).toEqual({ ok: false, errorCode: 'invalid_country' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a number that is invalid for the selected country (South African shape against Nigeria)', async () => {
    const { admin, rpc } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(admin, 'u1', { ...valid, whatsapp: '0821234567' })
    expect(result).toEqual({ ok: false, errorCode: 'invalid_whatsapp' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts the same South African number against South Africa and stores it as E.164', async () => {
    const { admin, rpc } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(admin, 'u1', { ...valid, country: 'South Africa', whatsapp: '0821234567' })
    expect(result).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('complete_profile_onboarding', expect.objectContaining({ p_whatsapp: '+27821234567' }))
  })

  it('resolves a legacy free-text country ("Nigerian") via the existing alias table', async () => {
    const { admin, rpc } = fakeAdmin()
    const result = await performCompleteProfileOnboarding(admin, 'u1', { ...valid, country: 'Nigerian' })
    expect(result).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('complete_profile_onboarding', expect.objectContaining({ p_country: 'Nigerian', p_whatsapp: '+2348012345678' }))
  })

  it('does everything in ONE atomic database call', async () => {
    const { admin, rpc } = fakeAdmin()
    const from = vi.fn()
    ;(admin as unknown as { from: unknown }).from = from
    const result = await performCompleteProfileOnboarding(admin, 'u1', valid)
    expect(result).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('complete_profile_onboarding', {
      p_user_id: 'u1',
      p_country: 'Nigeria',
      p_whatsapp: '+2348012345678',
      p_consent: true,
      p_game_ids: [GAME_ID],
    })
    // No separate profiles / game_interest write that could succeed on its own.
    expect(from).not.toHaveBeenCalled()
  })

  it('passes consent false through as false (not coerced to the default)', async () => {
    const { admin, rpc } = fakeAdmin()
    await performCompleteProfileOnboarding(admin, 'u1', { ...valid, consentWhatsappUpdates: false })
    expect(rpc).toHaveBeenCalledWith('complete_profile_onboarding', expect.objectContaining({ p_consent: false }))
  })

  it('does not report success when the atomic write fails (nothing is stamped, so nothing to compensate)', async () => {
    const { admin } = fakeAdmin({ error: { code: '57014', message: 'boom' } })
    expect(await performCompleteProfileOnboarding(admin, 'u1', valid)).toEqual({ ok: false, errorCode: 'save_failed' })
  })

  it('maps an unknown game id (foreign-key violation) to unknown_game', async () => {
    const { admin } = fakeAdmin({ error: { code: '23503', message: 'fk' } })
    expect(await performCompleteProfileOnboarding(admin, 'u1', valid)).toEqual({ ok: false, errorCode: 'unknown_game' })
  })

  it("maps the function's empty-interests guard to invalid_input", async () => {
    const { admin } = fakeAdmin({ error: { code: '22023', message: 'at least one game interest is required' } })
    expect(await performCompleteProfileOnboarding(admin, 'u1', valid)).toEqual({ ok: false, errorCode: 'invalid_input' })
  })
})

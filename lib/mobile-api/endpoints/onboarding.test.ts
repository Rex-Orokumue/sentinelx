import { describe, it, expect, vi } from 'vitest'
import { completeProfileForUser } from './onboarding'
import { onboardingProfileCoreSchema } from '@/lib/onboarding/profile-schema'
import { ApiError } from '../errors'

const GAME = '11111111-1111-4111-8111-111111111111'
const body = { country: 'Nigeria', whatsapp: '08012345678', consentWhatsappUpdates: true, gameInterests: [GAME] }

function fakeAdmin(opts: { rpcError?: { code?: string; message: string } | null; completedAt?: string | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null })
  const maybeSingle = vi.fn().mockResolvedValue({ data: { profile_completed_at: opts.completedAt ?? '2026-10-03T16:00:00.000Z' } })
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }))
  return { admin: { rpc, from } as never, rpc, from }
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected the call to throw')
}

describe('POST /onboarding/profile body schema', () => {
  it('accepts consent true and consent false exactly as sent', () => {
    expect(onboardingProfileCoreSchema.parse(body).consentWhatsappUpdates).toBe(true)
    expect(onboardingProfileCoreSchema.parse({ ...body, consentWhatsappUpdates: false }).consentWhatsappUpdates).toBe(false)
  })

  it('never coerces consent: strings, numbers and a missing value are rejected', () => {
    for (const bad of ['true', 'false', 1, 0, null, undefined]) {
      expect(onboardingProfileCoreSchema.safeParse({ ...body, consentWhatsappUpdates: bad }).success).toBe(false)
    }
    const missing: Partial<typeof body> = { ...body }
    delete missing.consentWhatsappUpdates
    expect(onboardingProfileCoreSchema.safeParse(missing).success).toBe(false)
  })

  it('rejects an empty game-interest list and non-UUID ids', () => {
    expect(onboardingProfileCoreSchema.safeParse({ ...body, gameInterests: [] }).success).toBe(false)
    expect(onboardingProfileCoreSchema.safeParse({ ...body, gameInterests: ['nope'] }).success).toBe(false)
  })
})

describe('completeProfileForUser', () => {
  it('completes the profile in one atomic call and returns the server-stamped completion time', async () => {
    const { admin, rpc } = fakeAdmin({ completedAt: '2026-10-03T16:00:00.000Z' })
    const res = await completeProfileForUser(admin, 'u1', body)
    expect(res).toEqual({ profileCompletedAt: '2026-10-03T16:00:00.000Z' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('complete_profile_onboarding', expect.objectContaining({ p_whatsapp: '+2348012345678', p_consent: true }))
  })

  it('passes consent false through as false', async () => {
    const { admin, rpc } = fakeAdmin()
    await completeProfileForUser(admin, 'u1', { ...body, consentWhatsappUpdates: false })
    expect(rpc).toHaveBeenCalledWith('complete_profile_onboarding', expect.objectContaining({ p_consent: false }))
  })

  it('rejects an invalid country/WhatsApp pairing with a field error on whatsapp, without writing', async () => {
    const { admin, rpc } = fakeAdmin()
    const e = await failure(completeProfileForUser(admin, 'u1', { ...body, whatsapp: '0821234567' }))
    expect(e).toMatchObject({ status: 400, code: 'validation_failed', fields: { whatsapp: expect.any(String) } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an unrecognised country with a field error on country, without writing', async () => {
    const { admin, rpc } = fakeAdmin()
    const e = await failure(completeProfileForUser(admin, 'u1', { ...body, country: 'Atlantis' }))
    expect(e).toMatchObject({ status: 400, code: 'validation_failed', fields: { country: expect.any(String) } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps an unknown game id to a gameInterests field error', async () => {
    const { admin } = fakeAdmin({ rpcError: { code: '23503', message: 'fk' } })
    const e = await failure(completeProfileForUser(admin, 'u1', body))
    expect(e).toMatchObject({ status: 400, code: 'validation_failed', fields: { gameInterests: expect.any(String) } })
  })

  it('a failed game-interest write fails the whole call as 500 save_failed and reads no completion stamp', async () => {
    // The write is one transaction, so a failure means nothing was stamped. The endpoint must
    // surface the failure and must NOT go on to report a completion time.
    const { admin, from } = fakeAdmin({ rpcError: { code: '57014', message: 'canceling statement' } })
    const e = await failure(completeProfileForUser(admin, 'u1', body))
    expect(e).toMatchObject({ status: 500, code: 'save_failed' })
    expect(from).not.toHaveBeenCalled()
  })
})

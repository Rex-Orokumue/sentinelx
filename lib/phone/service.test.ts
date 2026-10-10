import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/whatsapp-cloud-api', () => ({ sendWhatsAppOtp: vi.fn(), isWhatsAppOtpConfigured: vi.fn() }))
vi.mock('@/lib/achievements/unlock', () => ({ checkAndUnlockAchievements: vi.fn(async () => {}) }))
vi.mock('@/lib/rate-limit/account-limiter', async (orig) => ({ ...(await orig<object>()), hitLimit: vi.fn(), refundLimitHit: vi.fn() }))

import { sendWhatsAppOtp, isWhatsAppOtpConfigured } from '@/lib/notifications/whatsapp-cloud-api'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { hitLimit, refundLimitHit } from '@/lib/rate-limit/account-limiter'
import { hashCode } from './hash'
import { performRequestPhoneCode, performConfirmPhoneCode } from './service'

interface State {
  country: string | null
  pending: { phone: string; code_hash: string; attempts: number; expires_at: string; created_at: string } | null
  profileUpdates: unknown[]
  upserts: unknown[]
  deleted: number
  attemptWrites: unknown[]
}
function fakeAdmin(state: State) {
  return {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country: state.country } }) }) }),
          update: (patch: unknown) => ({ eq: async () => { state.profileUpdates.push(patch); return { error: null } } }),
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.pending }) }) }),
        upsert: async (row: unknown) => { state.upserts.push(row); return { error: null } },
        update: (patch: unknown) => ({ eq: async () => { state.attemptWrites.push(patch); return { error: null } } }),
        delete: () => ({ eq: async () => { state.deleted++; return { error: null } } }),
      }
    },
  } as never
}
const fresh = (): State => ({ country: 'NG', pending: null, profileUpdates: [], upserts: [], deleted: 0, attemptWrites: [] })
const NOW = new Date('2026-10-07T10:00:00.000Z')

beforeEach(() => {
  vi.mocked(isWhatsAppOtpConfigured).mockReturnValue(true)
  vi.mocked(sendWhatsAppOtp).mockReset()
  vi.mocked(sendWhatsAppOtp).mockResolvedValue({ ok: true })
  vi.mocked(hitLimit).mockReset()
  vi.mocked(hitLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, hitId: 'otp-hit-1' })
  vi.mocked(refundLimitHit).mockClear()
  vi.mocked(checkAndUnlockAchievements).mockClear()
})

describe('performRequestPhoneCode', () => {
  it('rejects an unparseable number before any write or send', async () => {
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: 'abc', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'invalid_phone' })
    expect(s.upserts).toHaveLength(0)
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('enforces the 60 s resend cooldown with a retryAfterSeconds', async () => {
    const s = fresh()
    s.pending = { phone: '2348012345678', code_hash: 'h', attempts: 0, expires_at: '2099-01-01T00:00:00Z', created_at: new Date(NOW.getTime() - 20_000).toISOString() }
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'cooldown', retryAfterSeconds: 40 })
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('enforces the daily cap and does not send', async () => {
    vi.mocked(hitLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 })
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'daily_limit', retryAfterSeconds: 3600 })
    expect(s.upserts).toHaveLength(0)
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('stores a hashed code, sends it, and returns expiry and resend times', async () => {
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: true, expiresAt: new Date(NOW.getTime() + 600_000).toISOString(), resendAt: new Date(NOW.getTime() + 60_000).toISOString() })
    const row = s.upserts[0] as { user_id: string; phone: string; code_hash: string; attempts: number }
    expect(row).toMatchObject({ user_id: 'u1', attempts: 0 })
    const sent = vi.mocked(sendWhatsAppOtp).mock.calls[0][0]
    expect(sent.to).toBe(row.phone)
    expect(row.code_hash).toBe(hashCode(sent.code))
    expect(sent.code).toMatch(/^[0-9]{6}$/)
    expect(refundLimitHit).not.toHaveBeenCalled()
  })

  it('web mode treats an unconfigured sender as success (current behaviour, pinned)', async () => {
    vi.mocked(isWhatsAppOtpConfigured).mockReturnValue(false)
    vi.mocked(sendWhatsAppOtp).mockResolvedValue({ ok: false, skipped: true })
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r.ok).toBe(true)
    expect(refundLimitHit).not.toHaveBeenCalled()
  })

  it('strict mode refuses an unconfigured sender and writes nothing', async () => {
    vi.mocked(isWhatsAppOtpConfigured).mockReturnValue(false)
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: true, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'unavailable' })
    expect(s.upserts).toHaveLength(0)
    expect(hitLimit).not.toHaveBeenCalled()
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('reports send_failed when the provider rejects', async () => {
    vi.mocked(sendWhatsAppOtp).mockResolvedValue({ ok: false, error: 'bad' })
    const r = await performRequestPhoneCode({ admin: fakeAdmin(fresh()), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'send_failed' })
    expect(refundLimitHit).toHaveBeenCalledWith(expect.anything(), 'otp-hit-1')
  })
})

describe('performConfirmPhoneCode', () => {
  const pending = (over: Partial<NonNullable<State['pending']>> = {}) => ({
    phone: '2348012345678',
    code_hash: hashCode('123456'),
    attempts: 0,
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    created_at: NOW.toISOString(),
    ...over,
  })

  it.each(['', '12345', '1234567', 'abcdef'])('rejects the malformed code %j', async (code) => {
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(fresh()), userId: 'u1', code, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'invalid_code' })
  })

  it('needs a pending code', async () => {
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(fresh()), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects an expired code', async () => {
    const s = fresh()
    s.pending = pending({ expires_at: new Date(NOW.getTime() - 1).toISOString() })
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'expired' })
  })

  it('locks out after 5 attempts even with the right code', async () => {
    const s = fresh()
    s.pending = pending({ attempts: 5 })
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'attempts_exceeded' })
    expect(s.profileUpdates).toHaveLength(0)
  })

  it('counts a wrong attempt', async () => {
    const s = fresh()
    s.pending = pending({ attempts: 2 })
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '000000', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'wrong' })
    expect(s.attemptWrites).toEqual([{ attempts: 3 }])
    expect(s.profileUpdates).toHaveLength(0)
  })

  it('writes phone and verification time together, unlocks achievements, clears the pending row', async () => {
    const s = fresh()
    s.pending = pending()
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: true, verifiedAt: NOW.toISOString() })
    expect(s.profileUpdates).toEqual([{ phone: '2348012345678', phone_verified_at: NOW.toISOString() }])
    expect(checkAndUnlockAchievements).toHaveBeenCalledWith(expect.anything(), 'u1', { type: 'profile_updated' })
    expect(s.deleted).toBe(1)
  })
})

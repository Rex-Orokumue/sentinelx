import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/settings/deletion-flow', () => ({ performRequestDeletion: vi.fn(), performCancelDeletion: vi.fn(), performDeleteNow: vi.fn() }))
vi.mock('@/lib/phone/service', () => ({ performRequestPhoneCode: vi.fn(), performConfirmPhoneCode: vi.fn() }))
vi.mock('@/lib/auth/email-change-service', () => ({ performChangeEmail: vi.fn() }))
vi.mock('@/lib/auth/unlink-google-service', () => ({ performUnlinkGoogle: vi.fn() }))
vi.mock('@/lib/profile/locale-service', async (orig) => ({ ...(await orig<object>()), performSetLocale: vi.fn() }))
vi.mock('@/lib/rate-limit/account-limiter', async (orig) => ({ ...(await orig<object>()), hitLimit: vi.fn() }))
vi.mock('@/lib/auth/reauth', async (orig) => ({ ...(await orig<object>()), verifyPassword: vi.fn() }))
vi.mock('@/lib/auth/signup-blocks', () => ({ isIdentifierBanned: vi.fn(async () => false) }))

import { performRequestDeletion, performCancelDeletion, performDeleteNow } from '@/lib/settings/deletion-flow'
import { performRequestPhoneCode, performConfirmPhoneCode } from '@/lib/phone/service'
import { performChangeEmail } from '@/lib/auth/email-change-service'
import { performUnlinkGoogle } from '@/lib/auth/unlink-google-service'
import { performSetLocale } from '@/lib/profile/locale-service'
import { hitLimit } from '@/lib/rate-limit/account-limiter'
import { maskPhone, toAccountResponse, runWithCtx, handlers } from './account'

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    userId: 'u1',
    email: 'a@example.com',
    accessToken: 'tok',
    admin: {
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'a@example.com', new_email: null, identities: [{ identity_id: 'i1', provider: 'email' }] } }, error: null })) } },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null, phone: null, phone_verified_at: null, locale: 'en' } }) }) }) }),
    },
    ...over,
  }) as never

beforeEach(() => {
  vi.mocked(hitLimit).mockReset()
  vi.mocked(hitLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  for (const m of [performRequestDeletion, performCancelDeletion, performDeleteNow, performRequestPhoneCode, performConfirmPhoneCode, performChangeEmail, performUnlinkGoogle, performSetLocale]) {
    vi.mocked(m as never as () => void).mockReset()
  }
})

describe('maskPhone', () => {
  it('keeps only the last three digits', () => expect(maskPhone('2348012345678')).toBe('••••••••••678'))
  it('never leaks a short number', () => expect(maskPhone('12')).toBe('••'))
})

describe('toAccountResponse', () => {
  const profile = { deletion_requested_at: null, deleted_at: null, phone: null, phone_verified_at: null, locale: 'fr' }
  const user = { email: 'a@example.com', new_email: null, identities: [{ provider: 'google' }, { provider: 'email' }] }

  it('reports no deletion, no phone and the sign-in methods', () => {
    const r = toAccountResponse(profile, user as never, new Date('2026-10-07T00:00:00Z'))
    expect(r).toEqual({
      deletion: null,
      signIn: { email: 'a@example.com', pendingEmail: null, passwordIdentity: true, google: true },
      phone: null,
      locale: 'fr',
    })
  })

  it('computes the deletion window from the request time', () => {
    const r = toAccountResponse({ ...profile, deletion_requested_at: '2026-10-05T00:00:00.000Z' }, user as never, new Date('2026-10-07T00:00:00Z'))
    expect(r.deletion).toEqual({ requestedAt: '2026-10-05T00:00:00.000Z', dueAt: '2026-10-20T00:00:00.000Z', daysRemaining: 13 })
  })

  it('treats a tombstoned profile as not pending deletion', () => {
    const r = toAccountResponse({ ...profile, deletion_requested_at: '2026-10-05T00:00:00.000Z', deleted_at: '2026-10-06T00:00:00.000Z' }, user as never, new Date('2026-10-07T00:00:00Z'))
    expect(r.deletion).toBeNull()
  })

  it('masks a verified phone and never returns the number', () => {
    const r = toAccountResponse({ ...profile, phone: '2348012345678', phone_verified_at: '2026-10-01T00:00:00.000Z' }, user as never, new Date())
    expect(r.phone).toEqual({ masked: '••••••••••678', verifiedAt: '2026-10-01T00:00:00.000Z' })
    expect(JSON.stringify(r)).not.toContain('2348012345678')
  })

  it('reports the pending new email', () => {
    const r = toAccountResponse(profile, { ...user, new_email: 'next@example.com' } as never, new Date())
    expect(r.signIn.pendingEmail).toBe('next@example.com')
  })

  it('a Google-only identity list reports passwordIdentity false', () => {
    const r = toAccountResponse(profile, { ...user, identities: [{ provider: 'google' }] } as never, new Date())
    expect(r.signIn).toMatchObject({ passwordIdentity: false, google: true })
  })
})

describe('getAccount', () => {
  it('assembles the response from the profile row and the auth user', async () => {
    const res = await handlers.getAccount(ctx())
    expect(res).toMatchObject({ deletion: null, locale: 'en', signIn: { email: 'a@example.com', google: false, passwordIdentity: true } })
  })

  it('answers 404 when the profile row is missing', async () => {
    const c = ctx({ admin: { auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'a@b.c', identities: [] } }, error: null })) } }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } })
    expect(await handlers.getAccount(c)).toMatchObject({ status: 404, code: 'not_found' })
  })
})

describe('deletion endpoints', () => {
  it('POST /me/deletion requires the literal DELETE', async () => {
    const res = await handlers.requestDeletion(ctx(), { confirm: 'delete' as never })
    expect(res).toMatchObject({ status: 400, code: 'confirm_required' })
  })

  it('POST /me/deletion maps blockers to a 409 with details', async () => {
    vi.mocked(performRequestDeletion).mockResolvedValue({ ok: false, reason: 'blocked', blockers: [{ code: 'wallet_balance', amount: 5 }] })
    const res = await handlers.requestDeletion(ctx(), { confirm: 'DELETE' })
    expect(res).toMatchObject({ status: 409, code: 'deletion_blocked', details: { blockers: [{ code: 'wallet_balance', amount: 5 }] } })
  })

  it('POST /me/deletion returns ISO times on success', async () => {
    const requestedAt = new Date('2026-10-07T00:00:00.000Z')
    vi.mocked(performRequestDeletion).mockResolvedValue({ ok: true, requestedAt, dueAt: new Date('2026-10-22T00:00:00.000Z') })
    const res = await handlers.requestDeletion(ctx(), { confirm: 'DELETE' })
    expect(res).toEqual({ requestedAt: '2026-10-07T00:00:00.000Z', dueAt: '2026-10-22T00:00:00.000Z' })
  })

  it('DELETE /me/deletion cancels', async () => {
    vi.mocked(performCancelDeletion).mockResolvedValue({ ok: true })
    expect(await handlers.cancelDeletion(ctx())).toEqual({ ok: true })
  })

  it('execute maps a username mismatch to 400', async () => {
    vi.mocked(performDeleteNow).mockResolvedValue({ ok: false, reason: 'username_mismatch' })
    const res = await handlers.deleteNow(ctx(), { username: 'x' })
    expect(res).toMatchObject({ status: 400, code: 'username_mismatch' })
  })
})

describe('phone endpoints', () => {
  it('requests a code in strict mode', async () => {
    vi.mocked(performRequestPhoneCode).mockResolvedValue({ ok: true, expiresAt: 'e', resendAt: 'r' })
    const res = await handlers.requestPhoneCode(ctx(), { phone: '08012345678' })
    expect(res).toEqual({ expiresAt: 'e', resendAt: 'r' })
    expect(vi.mocked(performRequestPhoneCode).mock.calls[0][0]).toMatchObject({ userId: 'u1', strictDelivery: true })
  })

  it.each([
    ['unavailable', 503, 'phone_unavailable'],
    ['invalid_phone', 400, 'phone_invalid'],
    ['send_failed', 502, 'phone_send_failed'],
    ['save_failed', 500, 'phone_save_failed'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    vi.mocked(performRequestPhoneCode).mockResolvedValue({ ok: false, reason })
    expect(await handlers.requestPhoneCode(ctx(), { phone: '08012345678' })).toMatchObject({ status, code })
  })

  it.each([
    ['cooldown', 'phone_cooldown'],
    ['daily_limit', 'phone_daily_limit'],
  ] as const)('maps %s to a 429 with retryAfterSeconds', async (reason, code) => {
    vi.mocked(performRequestPhoneCode).mockResolvedValue({ ok: false, reason, retryAfterSeconds: 40 })
    expect(await handlers.requestPhoneCode(ctx(), { phone: '08012345678' })).toMatchObject({ status: 429, code, fields: { retryAfterSeconds: '40' } })
  })

  it.each([
    ['invalid_code', 400, 'phone_code_invalid'],
    ['missing', 409, 'phone_code_missing'],
    ['expired', 409, 'phone_code_expired'],
    ['attempts_exceeded', 429, 'phone_attempts_exceeded'],
    ['wrong', 400, 'phone_code_wrong'],
  ] as const)('confirm maps %s to %i %s', async (reason, status, code) => {
    vi.mocked(performConfirmPhoneCode).mockResolvedValue({ ok: false, reason })
    expect(await handlers.confirmPhoneCode(ctx(), { code: '123456' })).toMatchObject({ status, code })
  })

  it('confirm returns the verification time', async () => {
    vi.mocked(performConfirmPhoneCode).mockResolvedValue({ ok: true, verifiedAt: 'v' })
    expect(await handlers.confirmPhoneCode(ctx(), { code: '123456' })).toEqual({ verifiedAt: 'v' })
  })
})

describe('password-taking endpoints', () => {
  it('POST /me/email answers 429 when the re-auth limit is hit, before checking the password', async () => {
    vi.mocked(hitLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 300 })
    const res = await handlers.changeEmail(ctx(), { email: 'n@example.com', password: 'pw' })
    expect(res).toMatchObject({ status: 429, code: 'reauth_rate_limited', fields: { retryAfterSeconds: '300' } })
    expect(performChangeEmail).not.toHaveBeenCalled()
  })

  it('POST /me/email returns sentTo', async () => {
    vi.mocked(performChangeEmail).mockResolvedValue({ ok: true, sentTo: 'n@example.com' })
    expect(await handlers.changeEmail(ctx(), { email: 'N@example.com', password: 'pw' })).toEqual({ sentTo: 'n@example.com' })
  })

  it.each([
    ['wrong_password', 400],
    ['google_only', 400],
    ['same_email', 400],
    ['email_banned', 400],
    ['email_in_use', 409],
    ['failed', 502],
  ] as const)('POST /me/email maps %s to %i with the same code', async (errorCode, status) => {
    vi.mocked(performChangeEmail).mockResolvedValue({ ok: false, errorCode })
    expect(await handlers.changeEmail(ctx(), { email: 'n@example.com', password: 'pw' })).toMatchObject({ status, code: errorCode })
  })

  it('DELETE /me/identities/google is limited like email change', async () => {
    vi.mocked(hitLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 60 })
    const res = await handlers.unlinkGoogle(ctx(), { password: 'pw' })
    expect(res).toMatchObject({ status: 429, code: 'reauth_rate_limited' })
    expect(performUnlinkGoogle).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong_password', 400, 'wrong_password'],
    ['not_linked', 409, 'not_linked'],
    ['last_identity', 409, 'last_identity'],
    ['unavailable', 503, 'linking_unavailable'],
    ['failed', 502, 'failed'],
  ] as const)('unlink maps %s to %i %s', async (errorCode, status, code) => {
    vi.mocked(performUnlinkGoogle).mockResolvedValue({ ok: false, errorCode })
    expect(await handlers.unlinkGoogle(ctx(), { password: 'pw' })).toMatchObject({ status, code })
  })

  it('unlink succeeds', async () => {
    vi.mocked(performUnlinkGoogle).mockResolvedValue({ ok: true })
    expect(await handlers.unlinkGoogle(ctx(), { password: 'pw' })).toEqual({ ok: true })
  })
})

describe('PUT /me/locale', () => {
  it('returns the saved locale', async () => {
    vi.mocked(performSetLocale).mockResolvedValue({ ok: true, locale: 'pcm' })
    expect(await handlers.setLocale(ctx(), { locale: 'pcm' })).toEqual({ locale: 'pcm' })
  })
  it('maps a save failure to 500', async () => {
    vi.mocked(performSetLocale).mockResolvedValue({ ok: false, reason: 'save_failed' })
    expect(await handlers.setLocale(ctx(), { locale: 'fr' })).toMatchObject({ status: 500, code: 'locale_save_failed' })
  })
})

describe('runWithCtx', () => {
  it('turns a returned error descriptor into an ApiError', async () => {
    await expect(runWithCtx(async () => ({ status: 409, code: 'x', message: 'y' }))).rejects.toMatchObject({ status: 409, code: 'x' })
  })
  it('passes a normal value through', async () => {
    expect(await runWithCtx(async () => ({ ok: true }))).toEqual({ ok: true })
  })
})

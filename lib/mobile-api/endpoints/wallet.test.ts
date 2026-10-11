import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'

const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  runIdempotent: vi.fn(),
  loadWalletOverview: vi.fn(),
  loadTransactionsPage: vi.fn(),
  loadWithdrawalsPage: vi.fn(),
  startDeposit: vi.fn(),
  submitWithdrawal: vi.fn(),
  resolvePayout: vi.fn(),
  savePayoutAccount: vi.fn(),
  clearPayoutAccount: vi.fn(),
  listBanks: vi.fn(),
  confirmWalletDeposit: vi.fn(),
  getWalletBalance: vi.fn(),
  hitLimit: vi.fn(),
}))
vi.mock('../auth', () => ({ authenticate: m.authenticate, optionalAuth: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent: m.runIdempotent }))
vi.mock('@/lib/wallet/overview', () => ({ loadWalletOverview: m.loadWalletOverview }))
vi.mock('@/lib/wallet/transactions-page', async (orig) => ({ ...(await orig<object>()), loadTransactionsPage: m.loadTransactionsPage }))
vi.mock('@/lib/wallet/withdrawals-page', async (orig) => ({ ...(await orig<object>()), loadWithdrawalsPage: m.loadWithdrawalsPage }))
vi.mock('@/lib/wallet/deposit-service', () => ({ startDeposit: m.startDeposit }))
vi.mock('@/lib/wallet/withdrawal-service', () => ({ submitWithdrawal: m.submitWithdrawal }))
vi.mock('@/lib/kyc/payout-service', () => ({ resolvePayout: m.resolvePayout, savePayoutAccount: m.savePayoutAccount, clearPayoutAccount: m.clearPayoutAccount }))
vi.mock('@/lib/paystack/server', () => ({ listBanks: m.listBanks }))
vi.mock('@/lib/wallet/confirm', () => ({ confirmWalletDeposit: m.confirmWalletDeposit }))
vi.mock('@/lib/wallet/service', () => ({ getWalletBalance: m.getWalletBalance }))
vi.mock('@/lib/rate-limit/account-limiter', async (orig) => ({ ...(await orig<object>()), hitLimit: m.hitLimit }))

import {
  getMyWalletEndpoint, listMyWalletTransactionsEndpoint, listWalletBanksEndpoint, resolvePayoutAccountEndpoint,
  setPayoutAccountEndpoint, removePayoutAccountEndpoint, startWalletDepositEndpoint, getWalletDepositEndpoint,
  requestWithdrawalEndpoint, listMyWithdrawalsEndpoint,
} from './wallet'
import {
  DEPOSIT_START_LIMIT, RESOLVE_LIMIT, DEPOSIT_POLL_LIMIT, depositKey, resolveKey, depositPollKey,
} from '@/lib/rate-limit/account-limiter'
import { Errors } from '../errors'

const BASE = 'https://x.test/api/mobile/v1'
const masked = { bankName: 'GTBank', accountName: 'ADA OBI', accountNumberMasked: '•••6789' }

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const idem = { 'idempotency-key': 'k1' }
const json = async (res: Response) => res.json()

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.authenticate.mockResolvedValue({ userId: 'owner-1', email: 'o@x.test', admin: 'admin' })
  m.runIdempotent.mockImplementation(async (_a: unknown, _k: unknown, run: () => unknown) => run())
  m.hitLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('every operation requires sign-in', () => {
  it.each([
    ['getMyWallet', () => getMyWalletEndpoint.handler(req('GET', '/wallet'))],
    ['listMyWalletTransactions', () => listMyWalletTransactionsEndpoint.handler(req('GET', '/wallet/transactions'))],
    ['listWalletBanks', () => listWalletBanksEndpoint.handler(req('GET', '/wallet/banks'))],
    ['resolvePayoutAccount', () => resolvePayoutAccountEndpoint.handler(req('POST', '/wallet/payout-account/resolve', { bankCode: '058', accountNumber: '0123456789' }))],
    ['setPayoutAccount', () => setPayoutAccountEndpoint.handler(req('PUT', '/wallet/payout-account', { bankCode: '058', accountNumber: '0123456789' }))],
    ['removePayoutAccount', () => removePayoutAccountEndpoint.handler(req('DELETE', '/wallet/payout-account'))],
    ['startWalletDeposit', () => startWalletDepositEndpoint.handler(req('POST', '/wallet/deposits', { amount: 500 }, idem))],
    ['getWalletDeposit', () => getWalletDepositEndpoint.handler(req('GET', '/wallet/deposits/r1'), { params: { reference: 'r1' } })],
    ['requestWithdrawal', () => requestWithdrawalEndpoint.handler(req('POST', '/wallet/withdrawals', { amount: 500 }, idem))],
    ['listMyWithdrawals', () => listMyWithdrawalsEndpoint.handler(req('GET', '/wallet/withdrawals'))],
  ] as const)('%s -> 401 when unauthenticated', async (_name, call) => {
    m.authenticate.mockRejectedValue(Errors.unauthorized())
    expect((await call()).status).toBe(401)
  })
})

describe('GET /wallet', () => {
  it("returns the signed-in player's overview, scoped to ctx.userId", async () => {
    const value = { balance: 5000, coinBalance: 1250, pendingWithdrawal: 0, earnings: { tournamentPrize: 0, referral: 0, bonus: 0, tournamentPrizeTrendPct: null }, recentTransactions: [], payoutAccount: masked, kycVerified: true, activeWithdrawal: null }
    m.loadWalletOverview.mockResolvedValue({ ok: true, value })
    const res = await getMyWalletEndpoint.handler(req('GET', '/wallet'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await json(res)).data).toEqual(value)
    expect(m.loadWalletOverview).toHaveBeenCalledWith('admin', 'owner-1')
  })
  it('maps a failed read to 500 wallet_load_failed', async () => {
    m.loadWalletOverview.mockResolvedValue({ ok: false, reason: 'load_failed' })
    const res = await getMyWalletEndpoint.handler(req('GET', '/wallet'))
    expect(res.status).toBe(500)
    expect((await json(res)).error.code).toBe('wallet_load_failed')
  })
})

describe('GET /wallet/transactions', () => {
  it('treats an unknown filter as all and passes the decoded cursor', async () => {
    m.loadTransactionsPage.mockResolvedValue({ ok: true, items: [], nextCursor: null })
    const res = await listMyWalletTransactionsEndpoint.handler(req('GET', '/wallet/transactions?filter=bogus'))
    expect(res.status).toBe(200)
    expect(m.loadTransactionsPage).toHaveBeenCalledWith('admin', 'owner-1', { filter: 'all', cursor: null })
    expect((await json(res)).data).toEqual({ items: [], nextCursor: null })
  })
  it('rejects a malformed cursor with 400 invalid_cursor before reading', async () => {
    const res = await listMyWalletTransactionsEndpoint.handler(req('GET', '/wallet/transactions?cursor=%25%25bad'))
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('invalid_cursor')
    expect(m.loadTransactionsPage).not.toHaveBeenCalled()
  })
  it('maps a failed read to 500', async () => {
    m.loadTransactionsPage.mockResolvedValue({ ok: false })
    expect((await listMyWalletTransactionsEndpoint.handler(req('GET', '/wallet/transactions'))).status).toBe(500)
  })
})

describe('GET /wallet/banks', () => {
  it('returns name and code only', async () => {
    m.listBanks.mockResolvedValue([{ name: 'GTBank', code: '058', extra: 'x' }])
    const res = await listWalletBanksEndpoint.handler(req('GET', '/wallet/banks'))
    expect((await json(res)).data).toEqual({ banks: [{ name: 'GTBank', code: '058' }] })
  })
  it('maps a Paystack failure to 503 payout_unavailable', async () => {
    m.listBanks.mockRejectedValue(new Error('down'))
    const res = await listWalletBanksEndpoint.handler(req('GET', '/wallet/banks'))
    expect(res.status).toBe(503)
    expect((await json(res)).error.code).toBe('payout_unavailable')
  })
})

describe('POST /wallet/payout-account/resolve', () => {
  const call = () => resolvePayoutAccountEndpoint.handler(req('POST', '/wallet/payout-account/resolve', { bankCode: '058', accountNumber: '0123456789' }))
  it('returns the resolved account name after one limiter hit', async () => {
    m.resolvePayout.mockResolvedValue({ ok: true, accountName: 'ADA OBI' })
    const res = await call()
    expect((await json(res)).data).toEqual({ accountName: 'ADA OBI' })
    expect(m.hitLimit).toHaveBeenCalledWith('admin', { key: resolveKey('owner-1'), ...RESOLVE_LIMIT })
  })
  it('429 rate_limited with retryAfterSeconds, and no Paystack call, when the limit is exhausted', async () => {
    m.hitLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    const res = await call()
    expect(res.status).toBe(429)
    const body = await json(res)
    expect(body.error.code).toBe('rate_limited')
    expect(body.error.fields).toEqual({ retryAfterSeconds: '42' })
    expect(m.resolvePayout).not.toHaveBeenCalled()
  })
  it('rejects a 9-digit account number with 400 validation_failed and spends no limiter hit', async () => {
    const res = await resolvePayoutAccountEndpoint.handler(req('POST', '/wallet/payout-account/resolve', { bankCode: '058', accountNumber: '012345678' }))
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('validation_failed')
    expect(m.hitLimit).not.toHaveBeenCalled()
  })
  it('maps account_unresolvable to 422', async () => {
    m.resolvePayout.mockResolvedValue({ ok: false, reason: 'account_unresolvable' })
    const res = await call()
    expect(res.status).toBe(422)
    expect((await json(res)).error.code).toBe('account_unresolvable')
  })
})

describe('PUT /wallet/payout-account', () => {
  const call = (body: unknown = { bankCode: '058', accountNumber: '0123456789' }) => setPayoutAccountEndpoint.handler(req('PUT', '/wallet/payout-account', body))
  it('saves for ctx.userId, ignoring any extra name fields, and returns only the masked account', async () => {
    m.savePayoutAccount.mockResolvedValue({ ok: true, payoutAccount: masked })
    const res = await call({ bankCode: '058', accountNumber: '0123456789', firstName: 'X', lastName: 'Y', accountName: 'EVIL' })
    expect(m.savePayoutAccount).toHaveBeenCalledWith('admin', { playerId: 'owner-1', bankCode: '058', accountNumber: '0123456789' })
    const text = JSON.stringify(await json(res))
    expect(text).toContain('•••6789')
    expect(text).not.toContain('0123456789')
  })
  it.each([
    ['already_verified', 409, 'already_verified'],
    ['account_unresolvable', 422, 'account_unresolvable'],
    ['unknown_bank', 422, 'unknown_bank'],
    ['payout_unavailable', 503, 'payout_unavailable'],
    ['pending_deletion', 403, 'account_pending_deletion'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    m.savePayoutAccount.mockResolvedValue({ ok: false, reason })
    const res = await call()
    expect(res.status).toBe(status)
    expect((await json(res)).error.code).toBe(code)
  })
  it('shares the resolve limit, since a save also spends a Paystack resolve', async () => {
    m.hitLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 })
    const res = await call()
    expect(res.status).toBe(429)
    expect(m.savePayoutAccount).not.toHaveBeenCalled()
  })
})

describe('DELETE /wallet/payout-account', () => {
  it('clears the owner payout account', async () => {
    m.clearPayoutAccount.mockResolvedValue({ ok: true })
    const res = await removePayoutAccountEndpoint.handler(req('DELETE', '/wallet/payout-account'))
    expect((await json(res)).data).toEqual({ removed: true })
    expect(m.clearPayoutAccount).toHaveBeenCalledWith('admin', 'owner-1')
  })
  it('500 payout_remove_failed when the delete fails', async () => {
    m.clearPayoutAccount.mockResolvedValue({ ok: false })
    const res = await removePayoutAccountEndpoint.handler(req('DELETE', '/wallet/payout-account'))
    expect(res.status).toBe(500)
    expect((await json(res)).error.code).toBe('payout_remove_failed')
  })
})

describe('POST /wallet/deposits', () => {
  const call = (amount: unknown = 5000, headers: Record<string, string> = idem) =>
    startWalletDepositEndpoint.handler(req('POST', '/wallet/deposits', { amount }, headers))
  it('requires an Idempotency-Key', async () => {
    const res = await call(5000, {})
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('idempotency_key_required')
    expect(m.startDeposit).not.toHaveBeenCalled()
  })
  it.each([[99], [100_000_001], [150.5], ['abc']])('rejects amount %s with 400', async (amount) => {
    expect((await call(amount)).status).toBe(400)
    expect(m.startDeposit).not.toHaveBeenCalled()
  })
  it('starts a deposit for ctx.userId using the token email and returns the checkout details', async () => {
    m.startDeposit.mockResolvedValue({ ok: true, reference: 'r1', authorizationUrl: 'https://pay.test/x', amount: 5000, fee: 175, total: 5175 })
    const res = await call(5000)
    expect(m.startDeposit).toHaveBeenCalledWith('admin', { playerId: 'owner-1', email: 'o@x.test', amount: 5000 })
    expect(m.hitLimit).toHaveBeenCalledWith('admin', { key: depositKey('owner-1'), ...DEPOSIT_START_LIMIT })
    expect((await json(res)).data).toEqual({ reference: 'r1', authorizationUrl: 'https://pay.test/x', amount: 5000, fee: 175, total: 5175 })
  })
  it('429 rate_limited after the hourly limit, without starting a deposit', async () => {
    m.hitLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 })
    const res = await call()
    expect(res.status).toBe(429)
    expect(m.startDeposit).not.toHaveBeenCalled()
  })
  it.each([
    ['pending_deletion', 403, 'account_pending_deletion'],
    ['email_required', 422, 'email_required'],
    ['paystack_failed', 502, 'payment_unavailable'],
    ['insert_failed', 500, 'deposit_failed'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    m.startDeposit.mockResolvedValue({ ok: false, reason })
    const res = await call()
    expect(res.status).toBe(status)
    expect((await json(res)).error.code).toBe(code)
  })
  it('runs through the idempotency layer keyed by the caller and route', async () => {
    m.startDeposit.mockResolvedValue({ ok: true, reference: 'r1', authorizationUrl: 'u', amount: 500, fee: 0, total: 500 })
    await call(500)
    expect(m.runIdempotent).toHaveBeenCalledWith('admin', { key: 'k1', userId: 'owner-1', route: '/api/mobile/v1/wallet/deposits' }, expect.any(Function))
  })
})

describe('GET /wallet/deposits/{reference}', () => {
  const call = (reference: string, deposits: Record<string, unknown>[]) => {
    m.authenticate.mockResolvedValue({ userId: 'owner-1', email: 'o@x.test', admin: fakeSupabase({ wallet_deposits: deposits }).client })
    return getWalletDepositEndpoint.handler(req('GET', `/wallet/deposits/${reference}`), { params: { reference } })
  }
  it("confirms the owner's own deposit and returns the balance once credited", async () => {
    m.confirmWalletDeposit.mockResolvedValue('confirmed')
    m.getWalletBalance.mockResolvedValue(6000)
    const res = await call('r1', [{ id: 'd1', player_id: 'owner-1', paystack_reference: 'r1' }])
    expect((await json(res)).data).toEqual({ status: 'confirmed', balance: 6000 })
  })
  it("returns not_found for another player's reference exactly like an unknown one, and never calls Paystack", async () => {
    const foreign = await json(await call('r2', [{ id: 'd2', player_id: 'stranger', paystack_reference: 'r2' }]))
    const unknown = await json(await call('nope', []))
    expect(foreign).toEqual({ data: { status: 'not_found', balance: null } })
    expect(unknown).toEqual(foreign)
    expect(m.confirmWalletDeposit).not.toHaveBeenCalled()
  })
  it('limits polling per player, after the ownership check and before Paystack is called', async () => {
    m.hitLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
    const res = await call('r1', [{ id: 'd1', player_id: 'owner-1', paystack_reference: 'r1' }])
    expect(res.status).toBe(429)
    expect((await json(res)).error.code).toBe('rate_limited')
    expect(m.hitLimit).toHaveBeenCalledWith(expect.anything(), { key: depositPollKey('owner-1'), ...DEPOSIT_POLL_LIMIT })
    expect(m.confirmWalletDeposit).not.toHaveBeenCalled()
  })

  it('does not spend a poll on a reference that is not the caller own', async () => {
    await call('nope', [])
    expect(m.hitLimit).not.toHaveBeenCalled()
  })

  it('does not return a balance for a not_successful deposit', async () => {
    m.confirmWalletDeposit.mockResolvedValue('not_successful')
    const res = await call('r1', [{ id: 'd1', player_id: 'owner-1', paystack_reference: 'r1' }])
    expect((await json(res)).data).toEqual({ status: 'not_successful', balance: null })
  })
})

describe('POST /wallet/withdrawals', () => {
  const call = (amount: unknown = 1500, headers: Record<string, string> = idem) =>
    requestWithdrawalEndpoint.handler(req('POST', '/wallet/withdrawals', { amount }, headers))
  it('requires an Idempotency-Key', async () => {
    expect((await call(1500, {})).status).toBe(400)
    expect(m.submitWithdrawal).not.toHaveBeenCalled()
  })
  it.each([[99], [100_000_001], [150.5]])('rejects amount %s with 400', async (amount) => {
    expect((await call(amount)).status).toBe(400)
  })
  it('files the request for ctx.userId and returns the masked payout account, never an account number key', async () => {
    m.submitWithdrawal.mockResolvedValue({ ok: true, id: 'wr1', amount: 1500, requestedAt: '2026-10-15T10:00:00.000Z', payoutAccount: masked })
    const res = await call(1500)
    expect(m.submitWithdrawal).toHaveBeenCalledWith('admin', { playerId: 'owner-1', amount: 1500 })
    const body = await json(res)
    expect(body.data).toEqual({ id: 'wr1', amount: 1500, status: 'pending', requestedAt: '2026-10-15T10:00:00.000Z', payoutAccount: masked })
    expect(JSON.stringify(body)).not.toContain('accountNumber"')
  })
  it.each([
    ['kyc_required', 422, 'kyc_required'],
    ['insufficient_balance', 422, 'insufficient_balance'],
    ['withdrawal_pending', 409, 'withdrawal_pending'],
    ['pending_deletion', 403, 'account_pending_deletion'],
    ['failed', 500, 'withdrawal_failed'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    m.submitWithdrawal.mockResolvedValue({ ok: false, reason })
    const res = await call()
    expect(res.status).toBe(status)
    expect((await json(res)).error.code).toBe(code)
  })
})

describe('GET /wallet/withdrawals', () => {
  it("lists the owner's requests with the decoded cursor", async () => {
    m.loadWithdrawalsPage.mockResolvedValue({ ok: true, items: [], nextCursor: null })
    const res = await listMyWithdrawalsEndpoint.handler(req('GET', '/wallet/withdrawals'))
    expect(m.loadWithdrawalsPage).toHaveBeenCalledWith('admin', 'owner-1', { cursor: null })
    expect((await json(res)).data).toEqual({ items: [], nextCursor: null })
  })
  it('rejects a malformed cursor and maps a failed read to 500', async () => {
    expect((await listMyWithdrawalsEndpoint.handler(req('GET', '/wallet/withdrawals?cursor=%25%25bad'))).status).toBe(400)
    m.loadWithdrawalsPage.mockResolvedValue({ ok: false })
    expect((await listMyWithdrawalsEndpoint.handler(req('GET', '/wallet/withdrawals'))).status).toBe(500)
  })
})

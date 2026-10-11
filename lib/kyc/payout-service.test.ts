import { describe, it, expect, vi, beforeEach } from 'vitest'

const { resolveAccount, listBanks, assertNotPendingDeletion } = vi.hoisted(() => ({
  resolveAccount: vi.fn(),
  listBanks: vi.fn(),
  assertNotPendingDeletion: vi.fn(),
}))
vi.mock('@/lib/paystack/server', () => ({ resolveAccount, listBanks }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion }))

import { resolvePayout, savePayoutAccount, clearPayoutAccount } from './payout-service'

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] }

function recorder(opts: { existingStatus?: string | null; upsertError?: boolean } = {}) {
  const calls: Call[] = []
  const admin = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const chain: Record<string, unknown> = {}
      const finish = (data: unknown, error: unknown = null) => ({ data, error })
      chain.select = () => chain
      chain.eq = (c: string, v: unknown) => { call.filters.push([c, v]); return chain }
      chain.maybeSingle = async () => {
        calls.push(call)
        return finish(opts.existingStatus ? { kyc_status: opts.existingStatus } : null)
      }
      chain.upsert = async (payload: unknown) => {
        calls.push({ ...call, op: 'upsert', payload })
        return finish(null, opts.upsertError ? { message: 'write failed' } : null)
      }
      chain.update = (payload: unknown) => {
        call.op = 'update'; call.payload = payload
        const u: Record<string, unknown> = {}
        u.eq = (c: string, v: unknown) => { call.filters.push([c, v]); calls.push(call); return Promise.resolve(finish(null)) }
        return u
      }
      chain.delete = () => {
        call.op = 'delete'
        const d: Record<string, unknown> = {}
        d.eq = (c: string, v: unknown) => { call.filters.push([c, v]); calls.push(call); return Promise.resolve(finish(null)) }
        return d
      }
      return chain
    },
  }
  return { admin: admin as never, calls }
}

beforeEach(() => {
  resolveAccount.mockReset().mockResolvedValue({ accountName: 'ADA OBI' })
  listBanks.mockReset().mockResolvedValue([{ name: 'GTBank', code: '058' }, { name: 'Test Bank', code: '001' }])
  assertNotPendingDeletion.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('resolvePayout', () => {
  it('returns the account name Paystack resolves', async () => {
    expect(await resolvePayout({ bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: true, accountName: 'ADA OBI' })
  })
  it.each([['9 digits', '058', '012345678'], ['letters', '058', '01234abcde'], ['no bank', '', '0123456789']])('rejects %s before calling Paystack', async (_n, bankCode, accountNumber) => {
    expect(await resolvePayout({ bankCode, accountNumber })).toEqual({ ok: false, reason: 'validation' })
    expect(resolveAccount).not.toHaveBeenCalled()
  })
  it('reports account_unresolvable when Paystack cannot resolve it', async () => {
    resolveAccount.mockRejectedValue(new Error('no match'))
    expect(await resolvePayout({ bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'account_unresolvable' })
  })
})

describe('savePayoutAccount', () => {
  it('resolves the name and bank name on the server, stores them as verified, and returns only the masked number', async () => {
    const { admin, calls } = recorder()
    const res = await savePayoutAccount(admin, { playerId: 'p1', bankCode: '058', accountNumber: '0123456789' })
    expect(res).toEqual({ ok: true, payoutAccount: { bankName: 'GTBank', accountName: 'ADA OBI', accountNumberMasked: '•••6789' } })
    expect(JSON.stringify(res)).not.toContain('0123456789')
    const upsert = calls.find((c) => c.op === 'upsert')!
    expect(upsert.payload).toEqual({
      player_id: 'p1', kyc_status: 'verified', kyc_failure_reason: null,
      payout_bank_code: '058', payout_bank_name: 'GTBank', payout_account_number: '0123456789', payout_account_name: 'ADA OBI',
    })
    const flag = calls.find((c) => c.table === 'profiles' && c.op === 'update')!
    expect(flag.payload).toEqual({ kyc_verified: true })
    expect(flag.filters).toEqual([['id', 'p1']])
  })

  it('refuses an already verified account without calling Paystack', async () => {
    const { admin } = recorder({ existingStatus: 'verified' })
    expect(await savePayoutAccount(admin, { playerId: 'p1', bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'already_verified' })
    expect(resolveAccount).not.toHaveBeenCalled()
  })

  it('refuses an account pending deletion', async () => {
    assertNotPendingDeletion.mockResolvedValue('Scheduled for deletion.')
    const { admin, calls } = recorder()
    expect(await savePayoutAccount(admin, { playerId: 'p1', bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'pending_deletion' })
    expect(calls.some((c) => c.op === 'upsert')).toBe(false)
  })

  it('validates the input', async () => {
    const { admin } = recorder()
    expect(await savePayoutAccount(admin, { playerId: 'p1', bankCode: '058', accountNumber: '12' })).toEqual({ ok: false, reason: 'validation' })
  })

  it('reports account_unresolvable, unknown_bank and payout_unavailable distinctly and writes nothing', async () => {
    const a = recorder()
    resolveAccount.mockRejectedValueOnce(new Error('no match'))
    expect(await savePayoutAccount(a.admin, { playerId: 'p1', bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'account_unresolvable' })
    const b = recorder()
    expect(await savePayoutAccount(b.admin, { playerId: 'p1', bankCode: '999', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'unknown_bank' })
    const c = recorder()
    listBanks.mockRejectedValueOnce(new Error('bank list down'))
    expect(await savePayoutAccount(c.admin, { playerId: 'p1', bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'payout_unavailable' })
    for (const r of [a, b, c]) expect(r.calls.some((x) => x.op === 'upsert')).toBe(false)
  })

  it('reports payout_unavailable when the write fails, and does not set the verified flag', async () => {
    const { admin, calls } = recorder({ upsertError: true })
    expect(await savePayoutAccount(admin, { playerId: 'p1', bankCode: '058', accountNumber: '0123456789' })).toEqual({ ok: false, reason: 'payout_unavailable' })
    expect(calls.some((c) => c.table === 'profiles')).toBe(false)
  })
})

describe('clearPayoutAccount', () => {
  it("deletes the player's payout row and clears the verified flag", async () => {
    const { admin, calls } = recorder()
    expect(await clearPayoutAccount(admin, 'p1')).toEqual({ ok: true })
    expect(calls.find((c) => c.op === 'delete')).toMatchObject({ table: 'player_kyc', filters: [['player_id', 'p1']] })
    expect(calls.find((c) => c.table === 'profiles')).toMatchObject({ op: 'update', payload: { kyc_verified: false }, filters: [['id', 'p1']] })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'

const { notifyStaff, assertNotPendingDeletion } = vi.hoisted(() => ({
  notifyStaff: vi.fn(),
  assertNotPendingDeletion: vi.fn(),
}))
vi.mock('@/lib/admin/staff', () => ({ notifyStaff }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion }))

import { submitWithdrawal } from './withdrawal-service'

const verifiedKyc = {
  player_id: 'p1', kyc_status: 'verified',
  payout_bank_name: 'GTBank', payout_account_number: '0123456789', payout_account_name: 'ADA OBI',
}

function setup(opts: { kyc?: Record<string, unknown> | null; rpcResult?: unknown; rpcError?: boolean } = {}) {
  const calls: unknown[] = []
  const { client } = fakeSupabase({
    player_kyc: opts.kyc === null ? [] : [opts.kyc ?? verifiedKyc, { ...verifiedKyc, player_id: 'other', payout_account_number: '9999999999' }],
    profiles: [{ id: 'p1', display_name: 'Ada', username: 'ada' }],
    withdrawal_requests: [{ id: 'wr1', player_id: 'p1', requested_at: '2026-10-15T10:00:00.000Z' }],
  }, {
    rpc: { wallet_request_withdrawal: (args) => { calls.push(args); return opts.rpcResult ?? { status: 'ok', id: 'wr1', balance: 4000 } } },
  })
  if (opts.rpcError) (client as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { message: 'down' } })
  return { client: client as never, calls }
}

beforeEach(() => {
  notifyStaff.mockReset()
  assertNotPendingDeletion.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('submitWithdrawal', () => {
  it("files the request through the atomic function using the player's stored payout account, then notifies staff", async () => {
    const { client, calls } = setup()
    const res = await submitWithdrawal(client, { playerId: 'p1', amount: 1500 })
    expect(calls).toEqual([{
      p_player: 'p1', p_amount: 1500, p_bank_name: 'GTBank', p_account_number: '0123456789', p_account_name: 'ADA OBI', p_category: 'withdrawal',
    }])
    expect(res).toEqual({
      ok: true, id: 'wr1', amount: 1500, requestedAt: '2026-10-15T10:00:00.000Z',
      payoutAccount: { bankName: 'GTBank', accountName: 'ADA OBI', accountNumberMasked: '•••6789' },
    })
    expect(JSON.stringify(res)).not.toContain('0123456789')
    expect(notifyStaff).toHaveBeenCalledTimes(1)
    expect(notifyStaff.mock.calls[0][1]).toBe('withdrawal_pending')
  })

  it.each([
    ['no payout account row', null],
    ['an unverified account', { ...verifiedKyc, kyc_status: 'pending' }],
    ['a verified row missing the account number', { ...verifiedKyc, payout_account_number: null }],
  ] as const)('requires KYC: %s', async (_name, kyc) => {
    const { client, calls } = setup({ kyc })
    expect(await submitWithdrawal(client, { playerId: 'p1', amount: 1500 })).toEqual({ ok: false, reason: 'kyc_required' })
    expect(calls).toHaveLength(0)
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('refuses an account pending deletion before touching the wallet', async () => {
    assertNotPendingDeletion.mockResolvedValue('Scheduled for deletion.')
    const { client, calls } = setup()
    expect(await submitWithdrawal(client, { playerId: 'p1', amount: 1500 })).toEqual({ ok: false, reason: 'pending_deletion' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    [{ status: 'pending_exists' }, 'withdrawal_pending'],
    [{ status: 'insufficient' }, 'insufficient_balance'],
  ] as const)('maps %o to %s without notifying staff', async (rpcResult, reason) => {
    const { client } = setup({ rpcResult })
    expect(await submitWithdrawal(client, { playerId: 'p1', amount: 1500 })).toEqual({ ok: false, reason })
    expect(notifyStaff).not.toHaveBeenCalled()
  })

  it('reports failed (not insufficient) when the database call errors', async () => {
    const { client } = setup({ rpcError: true })
    expect(await submitWithdrawal(client, { playerId: 'p1', amount: 1500 })).toEqual({ ok: false, reason: 'failed' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'

const { initializeTransaction, assertNotPendingDeletion } = vi.hoisted(() => ({
  initializeTransaction: vi.fn(),
  assertNotPendingDeletion: vi.fn(),
}))
vi.mock('@/lib/paystack/server', () => ({
  initializeTransaction,
  buildWalletDepositReference: () => 'sxdep_test_ref',
}))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion }))

import { startDeposit } from './deposit-service'
import { computePaystackFee } from '@/lib/paystack/fees'

beforeEach(() => {
  initializeTransaction.mockReset().mockResolvedValue('https://checkout.paystack.test/abc')
  assertNotPendingDeletion.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('startDeposit', () => {
  it('records a pending deposit with the server-computed fee and charges amount + fee', async () => {
    const tables = { wallet_deposits: [] as Record<string, unknown>[] }
    const { client } = fakeSupabase(tables)
    const fee = computePaystackFee(5000)
    const res = await startDeposit(client as never, { playerId: 'p1', email: 'a@b.test', amount: 5000 })
    expect(res).toEqual({ ok: true, reference: 'sxdep_test_ref', authorizationUrl: 'https://checkout.paystack.test/abc', amount: 5000, fee, total: 5000 + fee })
    expect(tables.wallet_deposits).toEqual([{ player_id: 'p1', amount: 5000, fee, paystack_reference: 'sxdep_test_ref', status: 'pending' }])
    expect(initializeTransaction).toHaveBeenCalledWith({
      email: 'a@b.test',
      amountKobo: (5000 + fee) * 100,
      reference: 'sxdep_test_ref',
      callbackUrl: expect.stringMatching(/\/api\/paystack\/callback$/),
      metadata: { player_id: 'p1', amount: 5000, fee },
    })
  })

  it('refuses an account pending deletion without writing or calling Paystack', async () => {
    assertNotPendingDeletion.mockResolvedValue('Your account is scheduled for deletion.')
    const tables = { wallet_deposits: [] as Record<string, unknown>[] }
    const res = await startDeposit(fakeSupabase(tables).client as never, { playerId: 'p1', email: 'a@b.test', amount: 5000 })
    expect(res).toEqual({ ok: false, reason: 'pending_deletion' })
    expect(tables.wallet_deposits).toHaveLength(0)
    expect(initializeTransaction).not.toHaveBeenCalled()
  })

  it('needs an email and does not write a row without one', async () => {
    const tables = { wallet_deposits: [] as Record<string, unknown>[] }
    const res = await startDeposit(fakeSupabase(tables).client as never, { playerId: 'p1', email: null, amount: 5000 })
    expect(res).toEqual({ ok: false, reason: 'email_required' })
    expect(tables.wallet_deposits).toHaveLength(0)
  })

  it('reports insert_failed and does not call Paystack when the row cannot be written', async () => {
    const tables = { wallet_deposits: [{ paystack_reference: 'sxdep_test_ref' }] as Record<string, unknown>[] }
    const { client } = fakeSupabase(tables, { unique: { wallet_deposits: ['paystack_reference'] } })
    const res = await startDeposit(client as never, { playerId: 'p1', email: 'a@b.test', amount: 5000 })
    expect(res).toEqual({ ok: false, reason: 'insert_failed' })
    expect(initializeTransaction).not.toHaveBeenCalled()
  })

  it('reports paystack_failed when initialisation throws', async () => {
    initializeTransaction.mockRejectedValue(new Error('paystack down'))
    const res = await startDeposit(fakeSupabase({ wallet_deposits: [] }).client as never, { playerId: 'p1', email: 'a@b.test', amount: 5000 })
    expect(res).toEqual({ ok: false, reason: 'paystack_failed' })
  })
})

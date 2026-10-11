import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { loadWalletOverview } from './overview'

const OWNER = 'owner-1'
const STRANGER = 'stranger-2'
const NOW = new Date('2026-10-15T10:00:00.000Z')

const tx = (id: string, player_id: string, type: string, category: string | null, amount: number, created_at: string, reference_id: string | null = null) => ({
  id, player_id, type, category, amount, created_at, reference_id, note: 'PRIVATE NOTE',
})

function fixtures() {
  return {
    wallets: [
      { player_id: OWNER, balance: 5000 },
      { player_id: STRANGER, balance: 999999 },
    ],
    wallet_transactions: [
      // newest first, the order the page asks the database for
      tx('t5', OWNER, 'withdrawal_request', 'withdrawal', -1000, '2026-10-14T09:00:00.000Z', 'wr1'),
      tx('t4', OWNER, 'deposit', 'bonus', 700, '2026-10-12T09:00:00.000Z'),
      tx('t3', OWNER, 'prize', 'tournament_prize', 3000, '2026-10-10T09:00:00.000Z'),
      tx('t2', OWNER, 'referral', 'referral', 250, '2026-09-20T09:00:00.000Z'),
      tx('t1', OWNER, 'prize', 'tournament_prize', 2000, '2026-09-05T09:00:00.000Z'),
      tx('x1', STRANGER, 'prize', 'tournament_prize', 777777, '2026-10-13T09:00:00.000Z'),
    ],
    withdrawal_requests: [
      { id: 'wr1', player_id: OWNER, amount: 1000, status: 'pending', requested_at: '2026-10-14T09:00:00.000Z', admin_note: 'PRIVATE ADMIN NOTE' },
      { id: 'wrx', player_id: STRANGER, amount: 50000, status: 'pending', requested_at: '2026-10-14T09:00:00.000Z', admin_note: null },
    ],
    profiles: [
      { id: OWNER, kyc_verified: true },
      { id: STRANGER, kyc_verified: false },
    ],
    player_kyc: [
      { player_id: OWNER, payout_bank_name: 'GTBank', payout_account_number: '0123456789', payout_account_name: 'ADA OBI' },
      { player_id: STRANGER, payout_bank_name: 'Other', payout_account_number: '9999999999', payout_account_name: 'NOT YOU' },
    ],
  }
}

describe('loadWalletOverview', () => {
  it("returns only the owner's balance, earnings, recent rows, pending withdrawal and masked payout account", async () => {
    const { client } = fakeSupabase(fixtures())
    const result = await loadWalletOverview(client as never, OWNER, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected overview')
    const v = result.value
    expect(v.balance).toBe(5000)
    expect(v.pendingWithdrawal).toBe(1000)
    expect(v.activeWithdrawal).toEqual({ id: 'wr1', amount: 1000, requestedAt: '2026-10-14T09:00:00.000Z' })
    // Positive amounts only, by category (the stranger's 777,777 must not appear)
    expect(v.earnings.tournamentPrize).toBe(5000)
    expect(v.earnings.referral).toBe(250)
    expect(v.earnings.bonus).toBe(700)
    // October prize 3000 vs September 2000 = +50%
    expect(v.earnings.tournamentPrizeTrendPct).toBe(50)
    expect(v.recentTransactions.map((t) => t.id)).toEqual(['t5', 't4', 't3', 't2', 't1'])
    expect(v.recentTransactions[0]).toMatchObject({ id: 't5', type: 'withdrawal_request', status: 'pending', amount: -1000 })
    expect(v.payoutAccount).toEqual({ bankName: 'GTBank', accountName: 'ADA OBI', accountNumberMasked: '•••6789' })
    expect(v.kycVerified).toBe(true)
  })

  it('never exposes the full account number, ledger notes, reference ids or admin notes', async () => {
    const { client } = fakeSupabase(fixtures())
    const result = await loadWalletOverview(client as never, OWNER, NOW)
    const json = JSON.stringify(result)
    expect(json).not.toContain('0123456789')
    expect(json).not.toContain('PRIVATE')
    expect(json).not.toContain('reference')
    expect(json).not.toContain('NOT YOU')
  })

  it('returns zeros and nulls for a player with no wallet, ledger or payout account', async () => {
    const { client } = fakeSupabase({ wallets: [], wallet_transactions: [], withdrawal_requests: [], profiles: [{ id: OWNER, kyc_verified: false }], player_kyc: [] })
    const result = await loadWalletOverview(client as never, OWNER, NOW)
    expect(result).toMatchObject({
      ok: true,
      value: {
        balance: 0, pendingWithdrawal: 0, activeWithdrawal: null, payoutAccount: null, kycVerified: false,
        recentTransactions: [], earnings: { tournamentPrize: 0, referral: 0, bonus: 0, tournamentPrizeTrendPct: null },
      },
    })
  })

  it('reports load_failed, not zeros, when a read errors', async () => {
    const failing = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'order', 'in', 'limit']) chain[m] = () => chain
        const out = { data: table === 'wallets' ? null : [], error: table === 'wallets' ? { message: 'down' } : null }
        chain.maybeSingle = async () => out
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(out).then(resolve)
        return chain
      },
    }
    expect(await loadWalletOverview(failing as never, OWNER, NOW)).toEqual({ ok: false, reason: 'load_failed' })
  })
})

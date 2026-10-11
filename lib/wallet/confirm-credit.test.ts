import { describe, it, expect, vi, beforeEach } from 'vitest'

const { verifyTransaction, creditWallet, notifyInApp, updates, state } = vi.hoisted(() => ({
  verifyTransaction: vi.fn(),
  creditWallet: vi.fn(),
  notifyInApp: vi.fn(),
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  state: { deposit: null as null | { id: string; player_id: string; amount: number; fee: number; status: string } },
}))

vi.mock('@/lib/paystack/server', () => ({ verifyTransaction }))
vi.mock('./service', () => ({ creditWallet }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.deposit }) }) }),
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {}
        const chain = {
          eq: (col: string, val: unknown) => { filters[col] = val; return chain },
          select: async () => {
            updates.push({ patch, filters: { ...filters } })
            // Only the pending -> paid claim succeeds with a row; a release back to pending matches the paid row.
            const matches = (filters.status ?? null) === state.deposit?.status
            return { data: matches ? [{ id: filters.id }] : [] }
          },
        }
        // the release update is awaited without .select(): make the chain thenable
        return Object.assign(chain, {
          then: (resolve: (v: unknown) => void) => { updates.push({ patch, filters: { ...filters } }); resolve({ data: null }) },
        })
      },
    }),
  }),
}))

import { confirmWalletDeposit } from './confirm'

beforeEach(() => {
  updates.length = 0
  verifyTransaction.mockReset().mockResolvedValue({ status: 'success', amountKobo: 110_000 })
  creditWallet.mockReset()
  notifyInApp.mockReset()
  state.deposit = { id: 'dep1', player_id: 'p1', amount: 1000, fee: 100, status: 'pending' }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('confirmWalletDeposit credit handling', () => {
  it('credits once and notifies when the claim and the credit succeed', async () => {
    creditWallet.mockResolvedValue({ ok: true, balance: 1000 })
    expect(await confirmWalletDeposit('ref1')).toBe('confirmed')
    expect(creditWallet).toHaveBeenCalledTimes(1)
    expect(notifyInApp).toHaveBeenCalledTimes(1)
    // links to the wallet page so the mobile app (which maps /dashboard/wallet) opens the wallet, not the bell
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ type: 'wallet_credited', link: '/dashboard/wallet' }))
    expect(updates.some((u) => u.patch.status === 'pending')).toBe(false)
  })

  it('releases the paid claim back to pending when the credit fails, so a retry can credit it', async () => {
    creditWallet.mockResolvedValue({ ok: false })
    expect(await confirmWalletDeposit('ref1')).toBe('not_successful')
    expect(notifyInApp).not.toHaveBeenCalled()
    const release = updates.find((u) => u.patch.status === 'pending')
    expect(release).toBeDefined()
    expect(release!.filters).toMatchObject({ id: 'dep1', status: 'paid' })
  })
})

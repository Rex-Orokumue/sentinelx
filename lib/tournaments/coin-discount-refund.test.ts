import { describe, it, expect } from 'vitest'
import { refundAbandonedCoinDiscounts } from './coin-discount-refund'

function fakeAdmin(rows: { id: string; player_id: string; coins_used: number }[]) {
  const updates: Record<string, unknown>[] = []
  const coinInserts: Record<string, unknown>[] = []
  return {
    client: {
      from(table: string) {
        if (table === 'tournament_registrations') {
          return {
            select: () => ({
              eq: () => ({
                gt: () => ({
                  lt: async () => ({ data: rows }),
                }),
              }),
            }),
            update: (vals: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                updates.push({ id, ...vals })
                return { data: null, error: null }
              },
            }),
          }
        }
        if (table === 'sx_coins') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: 0, total_earned: 0, total_spent: 500 } }) }) }),
            upsert: async () => ({ data: null, error: null }),
          }
        }
        if (table === 'sx_coin_transactions') {
          return {
            insert: async (v: Record<string, unknown>) => {
              coinInserts.push(v)
              return { data: null, error: null }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    updates,
    coinInserts,
  }
}

describe('refundAbandonedCoinDiscounts', () => {
  it('refunds coins and zeroes the discount fields for stale pending registrations', async () => {
    const { client, updates, coinInserts } = fakeAdmin([{ id: 'reg1', player_id: 'p1', coins_used: 500 }])
    const result = await refundAbandonedCoinDiscounts(client as never, new Date('2026-08-16T12:00:00Z'))
    expect(result.refunded).toBe(1)
    expect(coinInserts[0]).toMatchObject({ player_id: 'p1', amount: 500, source: 'entry_discount_refund', reference_id: 'reg1' })
    expect(updates[0]).toMatchObject({ id: 'reg1', coins_used: 0, coin_discount_naira: 0 })
  })

  it('does nothing when there are no stale rows', async () => {
    const { client } = fakeAdmin([])
    const result = await refundAbandonedCoinDiscounts(client as never, new Date())
    expect(result.refunded).toBe(0)
  })
})

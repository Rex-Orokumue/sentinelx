import { describe, it, expect } from 'vitest'
import { refundAbandonedCoinDiscounts } from './coin-discount-refund'

function fakeAdmin(rows: { id: string; player_id: string; coins_used: number }[]) {
  const updates: Record<string, unknown>[] = []
  const coinCalls: Record<string, unknown>[] = []
  return {
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        coinCalls.push({ name, ...args })
        return { data: 500, error: null }
      },
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
        throw new Error(`unexpected table ${table}`)
      },
    },
    updates,
    coinCalls,
  }
}

describe('refundAbandonedCoinDiscounts', () => {
  it('refunds coins and zeroes the discount fields for stale pending registrations', async () => {
    const { client, updates, coinCalls } = fakeAdmin([{ id: 'reg1', player_id: 'p1', coins_used: 500 }])
    const result = await refundAbandonedCoinDiscounts(client as never, new Date('2026-08-16T12:00:00Z'))
    expect(result.refunded).toBe(1)
    expect(coinCalls[0]).toMatchObject({ name: 'coin_apply', p_player: 'p1', p_delta: 500, p_source: 'entry_discount_refund', p_reference: 'reg1', p_clamp: true })
    expect(updates[0]).toMatchObject({ id: 'reg1', coins_used: 0, coin_discount_naira: 0 })
  })

  it('does nothing when there are no stale rows', async () => {
    const { client } = fakeAdmin([])
    const result = await refundAbandonedCoinDiscounts(client as never, new Date())
    expect(result.refunded).toBe(0)
  })
})

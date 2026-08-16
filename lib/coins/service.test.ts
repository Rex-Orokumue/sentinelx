import { describe, it, expect } from 'vitest'
import { recordCoinTransaction, getCoinBalance } from './service'

function fakeAdmin(existing: { balance: number; total_earned: number; total_spent: number } | null) {
  const upserts: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []
  let row = existing
  return {
    client: {
      from(table: string) {
        if (table === 'sx_coins') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
            upsert: async (vals: Record<string, unknown>) => { upserts.push(vals); row = vals as never; return { data: null, error: null } },
          }
        }
        if (table === 'sx_coin_transactions') {
          return { insert: async (v: Record<string, unknown>) => { inserts.push(v); return { data: null, error: null } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    upserts,
    inserts,
  }
}

describe('getCoinBalance', () => {
  it('returns 0 for a player with no wallet row yet', async () => {
    const { client } = fakeAdmin(null)
    expect(await getCoinBalance(client as never, 'p1')).toBe(0)
  })
})

describe('recordCoinTransaction', () => {
  it('creates a wallet row lazily and logs the ledger row', async () => {
    const { client, upserts, inserts } = fakeAdmin(null)
    const newBalance = await recordCoinTransaction(client as never, 'p1', 20, 'match_played', 'm1')
    expect(newBalance).toBe(20)
    expect(upserts[0]).toMatchObject({ player_id: 'p1', balance: 20, total_earned: 20, total_spent: 0 })
    expect(inserts[0]).toMatchObject({ player_id: 'p1', amount: 20, balance_after: 20, source: 'match_played', reference_id: 'm1' })
  })

  it('adds to an existing balance', async () => {
    const { client } = fakeAdmin({ balance: 100, total_earned: 100, total_spent: 0 })
    const newBalance = await recordCoinTransaction(client as never, 'p1', 30, 'match_won', 'm1')
    expect(newBalance).toBe(130)
  })

  it('supports negative amounts for admin deductions without going below 0', async () => {
    const { client } = fakeAdmin({ balance: 40, total_earned: 100, total_spent: 60 })
    const newBalance = await recordCoinTransaction(client as never, 'p1', -100, 'admin_deduct', null)
    expect(newBalance).toBe(0)
  })
})

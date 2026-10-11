import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { loadTransactionsPage, parseFilter } from './transactions-page'
import { decodeCursor } from '@/lib/mobile-api/history-cursor'

const OWNER = 'owner-1'
const STRANGER = 'stranger-2'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const row = (n: number, player_id: string, type: string, category: string, amount: number, reference_id: string | null = null) => ({
  id: uuid(n), player_id, type, category, amount, reference_id, note: 'PRIVATE', created_at: `2026-10-${String(30 - n).padStart(2, '0')}T09:00:00.000Z`,
})

describe('parseFilter', () => {
  it.each([
    ['winnings', 'winnings'], ['withdrawals', 'withdrawals'], ['deposits', 'deposits'],
    ['all', 'all'], ['bogus', 'all'], ['', 'all'], [null, 'all'], [undefined, 'all'],
  ] as const)('%s -> %s', (raw, expected) => {
    expect(parseFilter(raw)).toBe(expected)
  })
})

describe('loadTransactionsPage', () => {
  it("returns only the owner's rows for each filter", async () => {
    const tables = {
      wallet_transactions: [
        row(1, OWNER, 'prize', 'tournament_prize', 3000),
        row(2, OWNER, 'deposit', 'bonus', 700),
        row(3, OWNER, 'withdrawal_request', 'withdrawal', -1000, uuid(900)),
        row(4, STRANGER, 'prize', 'tournament_prize', 777777),
      ],
      withdrawal_requests: [{ id: uuid(900), player_id: OWNER, status: 'paid' }],
    }
    const ids = async (filter: Parameters<typeof loadTransactionsPage>[2]['filter']) => {
      const { client } = fakeSupabase(tables)
      const res = await loadTransactionsPage(client as never, OWNER, { filter, cursor: null })
      if (!res.ok) throw new Error('expected page')
      return res.items.map((t) => t.id)
    }
    expect(await ids('all')).toEqual([uuid(1), uuid(2), uuid(3)])
    expect(await ids('winnings')).toEqual([uuid(1)])
    expect(await ids('withdrawals')).toEqual([uuid(3)])
    expect(await ids('deposits')).toEqual([uuid(2)])
  })

  it('maps a withdrawal row status from its request and never leaks notes or reference ids', async () => {
    const { client } = fakeSupabase({
      wallet_transactions: [row(1, OWNER, 'withdrawal_request', 'withdrawal', -1000, uuid(900))],
      withdrawal_requests: [{ id: uuid(900), player_id: OWNER, status: 'rejected' }],
    })
    const res = await loadTransactionsPage(client as never, OWNER, { filter: 'all', cursor: null })
    if (!res.ok) throw new Error('expected page')
    expect(res.items[0]).toMatchObject({ type: 'withdrawal_request', status: 'failed' })
    expect(JSON.stringify(res)).not.toContain('PRIVATE')
    expect(JSON.stringify(res)).not.toContain(uuid(900))
  })

  it('pages with a keyset cursor: 20 items and a cursor when more remain, none on the last page', async () => {
    const many = Array.from({ length: 21 }, (_, i) => row(i + 1, OWNER, 'prize', 'tournament_prize', 100))
    const first = await loadTransactionsPage(fakeSupabase({ wallet_transactions: many }).client as never, OWNER, { filter: 'all', cursor: null })
    if (!first.ok) throw new Error('expected page')
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    expect(decodeCursor(first.nextCursor!)).toEqual({ t: many[19].created_at, id: many[19].id })

    const last = await loadTransactionsPage(fakeSupabase({ wallet_transactions: many.slice(0, 5) }).client as never, OWNER, { filter: 'all', cursor: null })
    if (!last.ok) throw new Error('expected page')
    expect(last.nextCursor).toBeNull()
  })

  it('applies the keyset filter when a cursor is given', async () => {
    const { client, queries } = fakeSupabase({ wallet_transactions: [] })
    await loadTransactionsPage(client as never, OWNER, { filter: 'all', cursor: { t: '2026-10-01T00:00:00.000Z', id: uuid(5) } })
    expect(queries.find((q) => q.startsWith('wallet_transactions:'))).toContain('or')
  })

  it('reports a failed read instead of an empty page', async () => {
    const failing = {
      from: () => {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'or', 'order', 'limit', 'in']) chain[m] = () => chain
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve)
        return chain
      },
    }
    expect(await loadTransactionsPage(failing as never, OWNER, { filter: 'all', cursor: null })).toEqual({ ok: false })
  })
})

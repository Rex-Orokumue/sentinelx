import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { loadWithdrawalsPage, WITHDRAWAL_COLUMNS } from './withdrawals-page'
import { decodeCursor } from '@/lib/mobile-api/history-cursor'

const OWNER = 'owner-1'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const wr = (n: number, player_id: string, status = 'pending') => ({
  id: uuid(n), player_id, amount: 1000 + n, status,
  requested_at: `2026-10-${String(30 - n).padStart(2, '0')}T09:00:00.000Z`,
  resolved_at: status === 'pending' ? null : `2026-10-${String(30 - n).padStart(2, '0')}T12:00:00.000Z`,
  bank_name: 'GTBank', account_name: 'ADA OBI', account_number: '0123456789', admin_note: 'PRIVATE ADMIN NOTE',
})

describe('loadWithdrawalsPage', () => {
  it('selects no admin_note column and never returns it or the full account number', async () => {
    expect(WITHDRAWAL_COLUMNS).not.toContain('admin_note')
    const { client } = fakeSupabase({ withdrawal_requests: [wr(1, OWNER, 'rejected')] })
    const res = await loadWithdrawalsPage(client as never, OWNER, { cursor: null })
    const json = JSON.stringify(res)
    expect(json).not.toContain('PRIVATE')
    expect(json).not.toContain('0123456789')
    expect(res).toMatchObject({
      ok: true,
      items: [{
        id: uuid(1), amount: 1001, status: 'rejected',
        requestedAt: '2026-10-29T09:00:00.000Z', resolvedAt: '2026-10-29T12:00:00.000Z',
        payoutAccount: { bankName: 'GTBank', accountName: 'ADA OBI', accountNumberMasked: '•••6789' },
      }],
      nextCursor: null,
    })
  })

  it("returns only the owner's requests", async () => {
    const { client } = fakeSupabase({ withdrawal_requests: [wr(1, OWNER), wr(2, 'stranger')] })
    const res = await loadWithdrawalsPage(client as never, OWNER, { cursor: null })
    if (!res.ok) throw new Error('expected page')
    expect(res.items.map((i) => i.id)).toEqual([uuid(1)])
  })

  it('pages by requested_at: 20 items and a cursor when more remain', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => wr(i + 1, OWNER))
    const res = await loadWithdrawalsPage(fakeSupabase({ withdrawal_requests: rows }).client as never, OWNER, { cursor: null })
    if (!res.ok) throw new Error('expected page')
    expect(res.items).toHaveLength(20)
    expect(decodeCursor(res.nextCursor!)).toEqual({ t: rows[19].requested_at, id: rows[19].id })
  })

  it('applies the keyset filter on requested_at when a cursor is given', async () => {
    const { client, queries } = fakeSupabase({ withdrawal_requests: [] })
    await loadWithdrawalsPage(client as never, OWNER, { cursor: { t: '2026-10-01T00:00:00.000Z', id: uuid(5) } })
    expect(queries[0]).toContain('or')
  })

  it('reports a failed read', async () => {
    const failing = {
      from: () => {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'or', 'order', 'limit']) chain[m] = () => chain
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve)
        return chain
      },
    }
    expect(await loadWithdrawalsPage(failing as never, OWNER, { cursor: null })).toEqual({ ok: false })
  })
})

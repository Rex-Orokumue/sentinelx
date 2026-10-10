import { describe, it, expect } from 'vitest'
import { hitLimit, refundLimitHit } from './account-limiter'

interface Row { id: string; subject_key: string; created_at: string }

function fakeAdmin(rows: Row[]) {
  let n = 0
  const admin = {
    from: (table: string) => {
      if (table !== 'account_rate_limit_events') throw new Error(`unexpected table ${table}`)
      return {
        insert: (row: { subject_key: string; created_at?: string }) => ({
          select: () => ({
            single: async () => {
              const r: Row = { id: `r${++n}`, subject_key: row.subject_key, created_at: row.created_at ?? new Date().toISOString() }
              rows.push(r)
              return { data: { id: r.id }, error: null }
            },
          }),
        }),
        select: () => ({
          eq: (_c: string, key: string) => ({
            gte: (_c2: string, since: string) => ({
              order: async () => ({
                data: rows
                  .filter((r) => r.subject_key === key && r.created_at >= since)
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map(({ created_at }) => ({ created_at })),
                error: null,
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: async (_c: string, id: string) => {
            const i = rows.findIndex((r) => r.id === id)
            if (i >= 0) rows.splice(i, 1)
            return { error: null }
          },
        }),
      }
    },
  }
  return admin as never
}

const T0 = new Date('2026-10-07T10:00:00.000Z')
const at = (sec: number) => new Date(T0.getTime() + sec * 1000)

describe('hitLimit', () => {
  it('refunds only the hit made by the failed request', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    const first = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(0) })
    const failed = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(1) })
    expect(first.hitId).toBe('r1')
    expect(failed.hitId).toBe('r2')

    await refundLimitHit(admin, failed.hitId)
    expect(rows.map(({ id }) => id)).toEqual(['r1'])
  })

  it('allows hits up to the limit', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) {
      const r = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
      expect(r.allowed).toBe(true)
    }
  })

  it('blocks the hit after the limit, without counting the blocked attempt', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
    const blocked = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(3) })
    expect(blocked.allowed).toBe(false)
    expect(rows).toHaveLength(3)
  })

  it('reports when the oldest hit leaves the window', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
    const blocked = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(10) })
    // oldest hit at t=0 expires at t=60 -> 50 s from t=10
    expect(blocked.retryAfterSeconds).toBe(50)
  })

  it('allows again once old hits age out', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
    const later = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(65) })
    expect(later.allowed).toBe(true)
  })

  it('keeps subjects independent', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'a', limit: 3, windowMs: 60_000, now: at(i) })
    const other = await hitLimit(admin, { key: 'b', limit: 3, windowMs: 60_000, now: at(4) })
    expect(other.allowed).toBe(true)
  })
})

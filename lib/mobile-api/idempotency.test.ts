import { describe, it, expect, vi } from 'vitest'
import { runIdempotent } from './idempotency'

interface Row {
  key: string
  user_id: string
  route: string
  response: unknown
  status_code: number | null
  created_at: string
  completed_at: string | null
}

function fakeAdmin(seed: Row[] = []) {
  const rows: Row[] = seed
  function match(r: Row, filters: Record<string, unknown>) {
    return Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
  }
  function filterBuilder(onSelect: (filters: Record<string, unknown>) => unknown) {
    const filters: Record<string, unknown> = {}
    const b = {
      eq(col: string, val: unknown) { filters[col] = val; return b },
      is(col: string, val: null) { filters[col] = val; return b },
      select: async (_cols: string) => onSelect(filters),
      maybeSingle: async () => {
        const row = rows.find((r) => match(r, filters))
        return { data: row ? { ...row } : null }
      },
    }
    return b
  }
  const admin = {
    from(table: string) {
      if (table !== 'api_idempotency_keys') throw new Error(`unexpected table ${table}`)
      return {
        insert(values: { key: string; user_id: string; route: string }) {
          return {
            select: async (_cols: string) => {
              if (rows.some((r) => r.key === values.key && r.user_id === values.user_id && r.route === values.route)) {
                return { data: null, error: { code: '23505' } }
              }
              const row: Row = { key: values.key, user_id: values.user_id, route: values.route, response: null, status_code: null, created_at: new Date().toISOString(), completed_at: null }
              rows.push(row)
              return { data: [{ created_at: row.created_at }], error: null }
            },
          }
        },
        update(patch: Partial<Row>) {
          return filterBuilder((filters) => {
            const row = rows.find((r) => match(r, filters))
            if (!row) return { data: [], error: null }
            Object.assign(row, patch)
            return { data: [{ created_at: row.created_at }], error: null }
          })
        },
        select(_cols: string) {
          return filterBuilder(() => { throw new Error('select() must terminate with maybeSingle() in this fake') })
        },
      }
    },
  }
  return { admin: admin as never, rows }
}

const args = { key: 'k1', userId: 'u1', route: '/tournaments/t1/register' }

describe('runIdempotent', () => {
  it('claims, runs, and returns the result on a fresh key', async () => {
    const { admin, rows } = fakeAdmin()
    const run = vi.fn().mockResolvedValue({ status: 200, body: { data: { ok: true } } })
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { ok: true } } })
    expect(run).toHaveBeenCalledTimes(1)
    expect(rows[0].completed_at).not.toBeNull()
    expect(rows[0].response).toEqual({ data: { ok: true } })
  })

  it('replays the stored response without re-running, including an error response', async () => {
    const seeded: Row = { key: 'k1', user_id: 'u1', route: args.route, response: { error: { code: 'tournament_full', message: 'Full.' } }, status_code: 400, created_at: new Date().toISOString(), completed_at: new Date().toISOString() }
    const { admin } = fakeAdmin([seeded])
    const run = vi.fn()
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 400, body: { error: { code: 'tournament_full', message: 'Full.' } } })
    expect(run).not.toHaveBeenCalled()
  })

  it("polls and returns the winner's response when a concurrent claim completes before the staleness mark", async () => {
    const seeded: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date().toISOString(), completed_at: null }
    const { admin, rows } = fakeAdmin([seeded])
    const run = vi.fn()
    setTimeout(() => {
      rows[0].completed_at = new Date().toISOString()
      rows[0].status_code = 200
      rows[0].response = { data: { ok: 'from-the-other-request' } }
    }, 20)
    const result = await runIdempotent(admin, args, run, { pollIntervalMs: 50 })
    expect(result).toEqual({ status: 200, body: { data: { ok: 'from-the-other-request' } } })
    expect(run).not.toHaveBeenCalled()
  }, 10_000)

  it('reclaims a stale claim (>=30s old, never completed) and runs the service function itself', async () => {
    const stale: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date(Date.now() - 31_000).toISOString(), completed_at: null }
    const { admin, rows } = fakeAdmin([stale])
    const run = vi.fn().mockResolvedValue({ status: 200, body: { data: { reclaimed: true } } })
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { reclaimed: true } } })
    expect(run).toHaveBeenCalledTimes(1)
    expect(rows[0].completed_at).not.toBeNull()
  })

  it('discards a superseded fill (original holder finishes after a reclaim already completed) and returns the current response instead', async () => {
    const originalGeneration = new Date(Date.now() - 31_000).toISOString()
    const { admin, rows } = fakeAdmin([{ key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: originalGeneration, completed_at: null }])
    const run = vi.fn().mockImplementation(async () => {
      rows[0].created_at = new Date().toISOString() // the reclaimer's new generation
      rows[0].completed_at = new Date().toISOString()
      rows[0].status_code = 200
      rows[0].response = { data: { fromReclaimer: true } }
      return { status: 200, body: { data: { fromOriginal: true } } }
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { fromReclaimer: true } } })
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('superseded'), expect.anything())
    spy.mockRestore()
  })

  it('returns conflict when the poll window elapses with no completion and the row is not yet stale enough to reclaim', async () => {
    const inFlight: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date().toISOString(), completed_at: null }
    const { admin } = fakeAdmin([inFlight])
    const run = vi.fn()
    const result = await runIdempotent(admin, args, run, { pollMaxWaitMs: 300, pollIntervalMs: 50 })
    expect(result).toEqual({ conflict: true })
    expect(run).not.toHaveBeenCalled()
  })
})

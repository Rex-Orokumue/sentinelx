import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeCursor } from '../history-cursor'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))

import { xpEventsEndpoint, sxScoreEventsEndpoint, coinTransactionsEndpoint } from './histories'

const U = 'user-1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ts = (n: number) => `2026-09-24T10:00:${String(59 - n).padStart(2, '0')}.000000+00:00`

// Records the whole chain so a test can assert the exact query the endpoint built.
function recordingClient(rows: unknown[]) {
  const log: { table?: string; select?: string; eq?: [string, unknown][]; order?: [string, unknown][]; limit?: number; or?: string } = { eq: [], order: [] }
  const chain: Record<string, unknown> = {}
  chain.select = (c: string) => { log.select = c; return chain }
  chain.eq = (c: string, v: unknown) => { log.eq!.push([c, v]); return chain }
  chain.order = (c: string, o: unknown) => { log.order!.push([c, o]); return chain }
  chain.limit = (n: number) => { log.limit = n; return chain }
  chain.or = (f: string) => { log.or = f; return chain }
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(r)
  return { client: { from: (t: string) => { log.table = t; return chain } }, log }
}

const trap = new Proxy({}, { get() { throw new Error('the service-role client must not be touched') } })
const get = (ep: typeof xpEventsEndpoint, qs = '') => ep.handler(new Request(`https://x.test/api/mobile/v1/me/x${qs}`))

beforeEach(() => {
  authenticate.mockReset()
})

const xpRow = (n: number) => ({ id: id(n), xp: 10, source: 'match_played', created_at: ts(n), reference_id: 'SECRET-REF' })
const sxRow = (n: number) => ({ id: id(n), match_id: n % 2 ? id(900 + n) : null, event_type: 'match_completed', points_delta: 10, created_at: ts(n), note: 'staff remark: SECRET-NOTE' })
const coinRow = (n: number) => ({ id: id(n), amount: 5, balance_after: 105, source: 'match_won', description: 'Won a match', created_at: ts(n), reference_id: 'SECRET-REF' })

describe.each([
  { name: 'xp-events', ep: xpEventsEndpoint, table: 'xp_events', cols: 'id, xp, source, created_at', row: xpRow, keys: ['createdAt', 'id', 'source', 'xp'] },
  { name: 'sx-score-events', ep: sxScoreEventsEndpoint, table: 'sx_score_events', cols: 'id, match_id, event_type, points_delta, created_at', row: sxRow, keys: ['createdAt', 'eventType', 'id', 'matchId', 'pointsDelta'] },
  { name: 'coin-transactions', ep: coinTransactionsEndpoint, table: 'sx_coin_transactions', cols: 'id, amount, balance_after, source, description, created_at', row: coinRow, keys: ['amount', 'balanceAfter', 'createdAt', 'description', 'id', 'source'] },
])('GET /me/$name', ({ ep, table, cols, row, keys }) => {
  it('builds the expected query on the caller RLS client: explicit columns, own rows, newest first, 21 rows', async () => {
    const { client, log } = recordingClient([row(1)])
    authenticate.mockResolvedValue({ userId: U, userClient: client, admin: trap })
    const res = await get(ep)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(log.table).toBe(table)
    expect(log.select).toBe(cols)
    expect(log.eq).toEqual([['player_id', U]])
    expect(log.order).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]])
    expect(log.limit).toBe(21)
    expect(log.or).toBeUndefined()
  })

  it('never returns note or reference_id, even when the row carries them; exact item keys', async () => {
    const { client } = recordingClient([row(1)])
    authenticate.mockResolvedValue({ userId: U, userClient: client, admin: trap })
    const res = await get(ep)
    const text = await res.clone().text()
    expect(text).not.toContain('SECRET')
    expect(text).not.toMatch(/"note"|reference/)
    const data = (await res.json()).data
    expect(Object.keys(data).sort()).toEqual(['items', 'nextCursor'])
    expect(Object.keys(data.items[0]).sort()).toEqual(keys)
  })

  it('21 rows → 20 items and a nextCursor; the cursor then adds the keyset filter', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => row(i))
    const first = recordingClient(rows)
    authenticate.mockResolvedValue({ userId: U, userClient: first.client, admin: trap })
    const data = (await (await get(ep)).json()).data
    expect(data.items).toHaveLength(20)
    expect(data.nextCursor).toBeTruthy()

    const second = recordingClient([row(20)])
    authenticate.mockResolvedValue({ userId: U, userClient: second.client, admin: trap })
    const res = await get(ep, `?cursor=${data.nextCursor}`)
    expect(second.log.or).toBe(`created_at.lt."${ts(19)}",and(created_at.eq."${ts(19)}",id.lt.${id(19)})`)
    expect((await res.json()).data.nextCursor).toBeNull()
  })

  it('an invalid cursor is a 400 invalid_cursor and never reaches the database', async () => {
    const { client, log } = recordingClient([])
    authenticate.mockResolvedValue({ userId: U, userClient: client, admin: trap })
    const res = await get(ep, '?cursor=%25%25%25')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_cursor')
    expect(log.or).toBeUndefined()
  })

  it('a valid-looking cursor cannot smuggle filter syntax', async () => {
    const { client } = recordingClient([])
    authenticate.mockResolvedValue({ userId: U, userClient: client, admin: trap })
    const evil = Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00Z),id.eq.1', id: id(1) })).toString('base64url')
    expect((await get(ep, `?cursor=${evil}`)).status).toBe(400)
  })

  it('is a 401 without a signed-in user', async () => {
    authenticate.mockImplementation(async () => {
      const { Errors } = await import('../errors')
      throw Errors.unauthorized()
    })
    expect((await get(ep)).status).toBe(401)
  })
})

describe('sx score events: matchId', () => {
  it('is null when the event has no match', async () => {
    const { client } = recordingClient([sxRow(0), sxRow(1)])
    authenticate.mockResolvedValue({ userId: U, userClient: client, admin: trap })
    const items = (await (await get(sxScoreEventsEndpoint)).json()).data.items
    expect(items[0].matchId).toBeNull()
    expect(items[1].matchId).toBe(id(901))
  })
})

describe('cursor helper is what the endpoints decode', () => {
  it('encodeCursor output is accepted', async () => {
    const { client } = recordingClient([])
    authenticate.mockResolvedValue({ userId: U, userClient: client, admin: trap })
    const c = encodeCursor({ created_at: ts(3), id: id(3) })
    expect((await get(xpEventsEndpoint, `?cursor=${c}`)).status).toBe(200)
  })
})

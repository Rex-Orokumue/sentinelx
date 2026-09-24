import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor, keysetFilter, pageOf, HISTORY_PAGE_SIZE } from './history-cursor'

const ID = '11111111-1111-4111-8111-111111111111'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

describe('cursor', () => {
  it('round-trips and preserves the raw timestamp string (microseconds must survive)', () => {
    const row = { created_at: '2026-09-24T10:00:00.123456+00:00', id: ID }
    expect(decodeCursor(encodeCursor(row))).toEqual({ t: row.created_at, id: row.id })
  })

  it('rejects garbage, wrong shape, non-uuid ids and non-ISO timestamps', () => {
    const bad = [
      '%%%',
      b64({ t: 1 }),
      b64({ t: 'x', id: 'y' }),
      b64({ t: '2026-09-24T10:00:00Z', id: 'not-a-uuid' }),
      b64({ t: '2026-01-01T00:00:00Z),id.eq.1', id: ID }), // filter-injection attempt
      b64({ t: '2026-09-24T10:00:00Z', id: `${ID},id.eq.2` }),
    ]
    for (const raw of bad) expect(() => decodeCursor(raw)).toThrowError(expect.objectContaining({ status: 400, code: 'invalid_cursor' }))
  })

  it('keysetFilter quotes the timestamp', () => {
    expect(keysetFilter({ t: '2026-09-24T10:00:00.123456+00:00', id: ID })).toBe(
      `created_at.lt."2026-09-24T10:00:00.123456+00:00",and(created_at.eq."2026-09-24T10:00:00.123456+00:00",id.lt.${ID})`,
    )
  })
})

describe('pageOf', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ created_at: `2026-09-24T10:00:${String(59 - i).padStart(2, '0')}Z`, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))

  it('21 rows → 20 items and a cursor pointing at the 20th', () => {
    const r = rows(HISTORY_PAGE_SIZE + 1)
    const p = pageOf(r)
    expect(p.items).toHaveLength(HISTORY_PAGE_SIZE)
    expect(decodeCursor(p.nextCursor!).id).toBe(r[HISTORY_PAGE_SIZE - 1].id)
  })

  it('20 or fewer rows → no cursor', () => {
    expect(pageOf(rows(HISTORY_PAGE_SIZE)).nextCursor).toBeNull()
    expect(pageOf(rows(0))).toEqual({ items: [], nextCursor: null })
  })
})

// The keyset `(created_at, id) < (t, id0)` evaluated in JS, to prove paging is loss-free and duplicate-free when many
// rows share one timestamp (spec §10).
describe('keyset paging with tied timestamps', () => {
  const T = '2026-09-24T10:00:00.000000+00:00'
  const all = Array.from({ length: 45 }, (_, i) => ({ created_at: T, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
  const ordered = all.slice().sort((a, b) => (a.id < b.id ? 1 : -1)) // id desc within one timestamp

  function fetchPage(cursor: string | null) {
    const c = cursor ? decodeCursor(cursor) : null
    const rows = ordered.filter((r) => !c || r.created_at < c.t || (r.created_at === c.t && r.id < c.id)).slice(0, HISTORY_PAGE_SIZE + 1)
    return pageOf(rows)
  }

  it('walking every page returns each row exactly once, in order', () => {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const p = fetchPage(cursor)
      seen.push(...p.items.map((r) => r.id))
      cursor = p.nextCursor
    } while (cursor)
    expect(seen).toEqual(ordered.map((r) => r.id))
    expect(new Set(seen).size).toBe(45)
  })
})

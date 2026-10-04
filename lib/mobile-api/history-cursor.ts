import { ApiError } from './errors'

export const HISTORY_PAGE_SIZE = 20

// The cursor carries the EXACT created_at string PostgREST returned, never a JS Date: a Date round-trip truncates
// microseconds and would skip or duplicate rows that share a millisecond. These two patterns are also the
// filter-injection guard — the decoded values are interpolated into a PostgREST `.or()` string by keysetFilter().
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const invalid = () => new ApiError(400, 'invalid_cursor', 'Invalid cursor.')

export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.created_at, id: row.id })).toString('base64url')
}

export function decodeCursor(raw: string): { t: string; id: string } {
  let v: unknown
  try {
    v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  const o = v as { t?: unknown; id?: unknown } | null
  if (!o || typeof o.t !== 'string' || typeof o.id !== 'string' || !ISO.test(o.t) || !UUID.test(o.id)) throw invalid()
  return { t: o.t, id: o.id }
}

// Rows strictly older than the cursor under the ordering (created_at desc, id desc).
export function keysetFilter(c: { t: string; id: string }): string {
  return `created_at.lt."${c.t}",and(created_at.eq."${c.t}",id.lt.${c.id})`
}

// Feed this rows fetched with limit HISTORY_PAGE_SIZE + 1: the extra row only signals that another page exists.
export function pageOf<T extends { created_at: string; id: string }>(rows: T[]): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, HISTORY_PAGE_SIZE)
  return { items, nextCursor: rows.length > HISTORY_PAGE_SIZE ? encodeCursor(items[items.length - 1]) : null }
}

// Same keyset as keysetFilter but on a differently named timestamp column (e.g. dm_threads.last_message_at). The column
// is interpolated into a PostgREST `.or()` string, so it is restricted to plain identifiers.
export function keysetFilterOn(column: string, c: { t: string; id: string }): string {
  if (!/^[a-z_]+$/.test(column)) throw new Error('invalid keyset column')
  return `${column}.lt."${c.t}",and(${column}.eq."${c.t}",id.lt.${c.id})`
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export interface IdempotentResult {
  status: number
  body: unknown
}

export const DEFAULT_STALE_MS = 30_000
export const DEFAULT_POLL_INTERVAL_MS = 500

interface Row {
  created_at: string
  completed_at: string | null
  status_code: number | null
  response: unknown
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function selectRow(admin: Admin, args: { key: string; userId: string; route: string }): Promise<Row | null> {
  const { data } = await admin
    .from('api_idempotency_keys')
    .select('created_at, completed_at, status_code, response')
    .eq('key', args.key)
    .eq('user_id', args.userId)
    .eq('route', args.route)
    .maybeSingle()
  return (data as Row | null) ?? null
}

async function fillClaim(
  admin: Admin,
  args: { key: string; userId: string; route: string },
  generation: string,
  run: () => Promise<IdempotentResult>,
): Promise<IdempotentResult | { conflict: true }> {
  const result = await run()
  const filled = await admin
    .from('api_idempotency_keys')
    // result.body is always the JSON-serializable {data}/{error} envelope
    // built by defineEndpoint's runOnce() — safe to store as jsonb.
    .update({ response: result.body as never, status_code: result.status, completed_at: new Date().toISOString() })
    .eq('key', args.key)
    .eq('user_id', args.userId)
    .eq('route', args.route)
    .eq('created_at', generation)
    .is('completed_at', null)
    .select('created_at')
  if (filled.error || !filled.data || filled.data.length === 0) {
    // The side-effecting work in run() already happened for nothing — a
    // rising rate of this log is the signal the staleness threshold (spec
    // S4.2) is too tight relative to real request latency.
    console.error('[idempotency] superseded fill discarded', { key: args.key, userId: args.userId, route: args.route })
    const current = await selectRow(admin, args)
    if (current?.completed_at) return { status: current.status_code!, body: current.response }
    return { conflict: true }
  }
  return result
}

// Stripe-style: the same key always replays the same stored response,
// success or error — never distinguishes "safe to retry fresh" errors from
// any other kind. A client resubmitting materially new information must
// mint a fresh key (mobile spec S6.3 step 6).
export async function runIdempotent(
  admin: Admin,
  args: { key: string; userId: string; route: string },
  run: () => Promise<IdempotentResult>,
  opts: { staleMs?: number; pollIntervalMs?: number; pollMaxWaitMs?: number } = {},
): Promise<IdempotentResult | { conflict: true }> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const pollMaxWaitMs = opts.pollMaxWaitMs ?? staleMs

  const claimed = await admin
    .from('api_idempotency_keys')
    .insert({ key: args.key, user_id: args.userId, route: args.route })
    .select('created_at')
  if (!claimed.error && claimed.data && claimed.data.length > 0) {
    return fillClaim(admin, args, (claimed.data[0] as { created_at: string }).created_at, run)
  }

  let row = await selectRow(admin, args)
  if (!row) return { conflict: true }

  const pollDeadline = Date.now() + pollMaxWaitMs
  while (!row.completed_at) {
    const ageMs = Date.now() - new Date(row.created_at).getTime()
    if (ageMs < staleMs) {
      if (Date.now() >= pollDeadline) return { conflict: true }
      await sleep(pollIntervalMs)
      row = await selectRow(admin, args)
      if (!row) return { conflict: true }
      continue
    }
    const reclaimed = await admin
      .from('api_idempotency_keys')
      .update({ created_at: new Date().toISOString(), response: null, status_code: null, completed_at: null })
      .eq('key', args.key)
      .eq('user_id', args.userId)
      .eq('route', args.route)
      .eq('created_at', row.created_at)
      .is('completed_at', null)
      .select('created_at')
    if (!reclaimed.error && reclaimed.data && reclaimed.data.length > 0) {
      return fillClaim(admin, args, (reclaimed.data[0] as { created_at: string }).created_at, run)
    }
    row = await selectRow(admin, args)
    if (!row) return { conflict: true }
    if (!row.completed_at) return { conflict: true }
  }
  return { status: row.status_code!, body: row.response }
}

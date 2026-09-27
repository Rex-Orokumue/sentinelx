import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { defineEndpoint } from '../define-endpoint'
import { decodeCursor, keysetFilter, pageOf, HISTORY_PAGE_SIZE } from '../history-cursor'

type HistoryTable = 'xp_events' | 'sx_score_events' | 'sx_coin_transactions'

// One keyset page of the CALLER's own rows, newest first. Runs on the caller's RLS client (`xp_events_read`,
// `sx_score_events_read`, `sx_coin_transactions_read` already scope to auth.uid()) AND filters by player_id —
// RLS is the structural backstop, the filter is belt-and-braces. Never the service role.
// The select lists are explicit and deliberately omit `note` (staff remarks) and `reference_id`.
async function historyPage<T extends { created_at: string; id: string }>(
  client: SupabaseClient<Database>,
  userId: string,
  table: HistoryTable,
  cols: string,
  req: Request,
): Promise<{ items: T[]; nextCursor: string | null }> {
  const raw = new URL(req.url).searchParams.get('cursor')
  // Decode (and reject) BEFORE building a query: the decoded values are interpolated into an `.or()` filter string.
  const filter = raw ? keysetFilter(decodeCursor(raw)) : null

  let query = client
    .from(table)
    .select(cols)
    .eq('player_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1)
  if (filter) query = query.or(filter)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return pageOf((data ?? []) as unknown as T[])
}

const envelope = <I extends z.ZodTypeAny>(item: I) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict()

const xpItem = z.object({ id: z.string(), xp: z.number(), source: z.string(), createdAt: z.string() }).strict()

// Raw codes (`source`, `eventType`) are returned on purpose: the app maps each to a localized label with a generic
// fallback, so a new DB value can never break or blank a screen.
export const xpEventsEndpoint = defineEndpoint({
  operationId: 'getMyXpEvents',
  method: 'GET',
  path: '/me/xp-events',
  summary: "The signed-in player's XP ledger, newest first, 20 per page. Cursor-paged; `source` is a raw code.",
  auth: 'user',
  cacheControl: 'no-store',
  response: envelope(xpItem),
  handler: async ({ ctx, req }) => {
    const p = await historyPage<{ id: string; xp: number; source: string; created_at: string }>(
      ctx.userClient, ctx.userId, 'xp_events', 'id, xp, source, created_at', req,
    )
    return { items: p.items.map((r) => ({ id: r.id, xp: r.xp, source: r.source, createdAt: r.created_at })), nextCursor: p.nextCursor }
  },
})

const sxItem = z
  .object({ id: z.string(), eventType: z.string(), pointsDelta: z.number(), matchId: z.string().nullable(), createdAt: z.string() })
  .strict()

export const sxScoreEventsEndpoint = defineEndpoint({
  operationId: 'getMySxScoreEvents',
  method: 'GET',
  path: '/me/sx-score-events',
  summary: "The signed-in player's SX Score ledger, newest first, 20 per page. Cursor-paged; `eventType` is a raw code. Staff notes are never returned.",
  auth: 'user',
  cacheControl: 'no-store',
  response: envelope(sxItem),
  handler: async ({ ctx, req }) => {
    // `note` is free text that can carry staff remarks on flag events; the web never shows it, so neither do we.
    const p = await historyPage<{ id: string; match_id: string | null; event_type: string; points_delta: number; created_at: string }>(
      ctx.userClient, ctx.userId, 'sx_score_events', 'id, match_id, event_type, points_delta, created_at', req,
    )
    return {
      items: p.items.map((r) => ({ id: r.id, eventType: r.event_type, pointsDelta: r.points_delta, matchId: r.match_id, createdAt: r.created_at })),
      nextCursor: p.nextCursor,
    }
  },
})

const coinItem = z
  .object({
    id: z.string(), amount: z.number(), balanceAfter: z.number(), source: z.string(),
    description: z.string().nullable(), createdAt: z.string(),
  })
  .strict()

export const coinTransactionsEndpoint = defineEndpoint({
  operationId: 'getMyCoinTransactions',
  method: 'GET',
  path: '/me/coin-transactions',
  summary: "The signed-in player's SX Coin ledger, newest first, 20 per page. Cursor-paged; `source` is a raw code.",
  auth: 'user',
  cacheControl: 'no-store',
  response: envelope(coinItem),
  handler: async ({ ctx, req }) => {
    const p = await historyPage<{ id: string; amount: number; balance_after: number; source: string; description: string | null; created_at: string }>(
      ctx.userClient, ctx.userId, 'sx_coin_transactions', 'id, amount, balance_after, source, description, created_at', req,
    )
    return {
      items: p.items.map((r) => ({
        id: r.id, amount: r.amount, balanceAfter: r.balance_after, source: r.source, description: r.description, createdAt: r.created_at,
      })),
      nextCursor: p.nextCursor,
    }
  },
})

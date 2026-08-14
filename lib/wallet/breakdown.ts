import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

interface CategorizedTxn {
  amount: number
  category: string | null
}

// Pure — unit tested directly. Only positive (credit) amounts count toward
// "earnings"; a null category (pre-migration legacy row with no backfill
// match) is excluded rather than lumped into an inaccurate bucket.
export function summarizeEarningsByCategory(transactions: CategorizedTxn[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const t of transactions) {
    if (t.amount <= 0 || !t.category) continue
    totals[t.category] = (totals[t.category] ?? 0) + t.amount
  }
  return totals
}

export async function getEarningsBreakdown(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<Record<string, number>> {
  const { data } = await admin.from('wallet_transactions').select('amount, category').eq('player_id', playerId)
  return summarizeEarningsByCategory(data ?? [])
}

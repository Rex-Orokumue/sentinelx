import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export async function getCoinBalance(admin: Admin, playerId: string): Promise<number> {
  const { data } = await admin.from('sx_coins').select('balance').eq('player_id', playerId).maybeSingle()
  return data?.balance ?? 0
}

// Positive amount = earn, negative = spend/deduct. Floors at 0 (never a
// negative balance) — a negative award larger than the current balance
// clamps rather than erroring, matching sx_score's MAX(0, ...) clamp rule.
// Always logs a ledger row, mirroring wallet_transactions/sx_score_events.
export async function recordCoinTransaction(
  admin: Admin,
  playerId: string,
  amount: number,
  source: string,
  referenceId: string | null,
  description?: string,
): Promise<number> {
  const { data: existing } = await admin
    .from('sx_coins')
    .select('balance, total_earned, total_spent')
    .eq('player_id', playerId)
    .maybeSingle()

  const currentBalance = existing?.balance ?? 0
  const newBalance = Math.max(0, currentBalance + amount)
  const appliedDelta = newBalance - currentBalance

  await admin.from('sx_coins').upsert({
    player_id: playerId,
    balance: newBalance,
    total_earned: (existing?.total_earned ?? 0) + Math.max(0, appliedDelta),
    total_spent: (existing?.total_spent ?? 0) + Math.max(0, -appliedDelta),
    updated_at: new Date().toISOString(),
  })

  await admin.from('sx_coin_transactions').insert({
    player_id: playerId,
    amount: appliedDelta,
    balance_after: newBalance,
    source,
    reference_id: referenceId,
    description: description ?? null,
  })

  return newBalance
}

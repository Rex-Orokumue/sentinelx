import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export async function getCoinBalance(admin: Admin, playerId: string): Promise<number> {
  const { data } = await admin.from('sx_coins').select('balance').eq('player_id', playerId).maybeSingle()
  return data?.balance ?? 0
}

// Positive amount = earn, negative = deduct. Every balance change goes through the coin_apply Postgres
// function, which updates the balance and appends the ledger row in ONE transaction, so concurrent writers
// can never overwrite each other. This is the CLAMP mode: a negative award larger than the balance floors
// at 0 instead of erroring (admin deductions rely on that, matching sx_score's MAX(0, ...) rule).
//
// Resolves to the new balance, or null when the database call failed. It logs and never throws, so one
// failed award cannot abort a loop that is crediting several players.
export async function recordCoinTransaction(
  admin: Admin,
  playerId: string,
  amount: number,
  source: string,
  referenceId: string | null,
  description?: string,
): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc('coin_apply', {
      p_player: playerId,
      p_delta: amount,
      p_source: source,
      p_reference: referenceId,
      p_description: description ?? null,
      p_clamp: true,
    })
    if (error || data == null) {
      console.error('[coins] record failed', { source, message: error?.message })
      return null
    }
    return data
  } catch (err) {
    console.error('[coins] record threw', { source, message: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export type SpendCoinsResult = { ok: true; balance: number } | { ok: false; reason: 'insufficient' | 'unavailable' }

// STRICT mode: spend `amount` (a positive number of coins) or write nothing. An overdraft is `insufficient`;
// a database failure is `unavailable` and is never reported as "not enough coins".
export async function spendCoins(
  admin: Admin,
  playerId: string,
  amount: number,
  source: string,
  referenceId: string | null,
  description?: string,
): Promise<SpendCoinsResult> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'unavailable' }
  try {
    const { data, error } = await admin.rpc('coin_apply', {
      p_player: playerId,
      p_delta: -amount,
      p_source: source,
      p_reference: referenceId,
      p_description: description ?? null,
      p_clamp: false,
    })
    if (error) {
      console.error('[coins] spend failed', { source, message: error.message })
      return { ok: false, reason: 'unavailable' }
    }
    if (data == null) return { ok: false, reason: 'insufficient' }
    return { ok: true, balance: data }
  } catch (err) {
    console.error('[coins] spend threw', { source, message: err instanceof Error ? err.message : String(err) })
    return { ok: false, reason: 'unavailable' }
  }
}

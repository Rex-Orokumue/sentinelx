import { spendCoins } from '@/lib/coins/service'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type PayCoinStakeResult = { ok: true } | { ok: false; reason: 'insufficient' | 'unavailable' }

// A coin-staked friendly settles instantly (no Paystack redirect): one atomic, strict spend. A refused spend
// writes nothing; a coin-service failure is `unavailable` and is never reported as "not enough coins".
export async function payCoinStake(admin: Admin, args: { playerId: string; matchId: string; stake: number }): Promise<PayCoinStakeResult> {
  const spend = await spendCoins(admin, args.playerId, args.stake, 'friendly_stake', args.matchId, `Friendly stake — match ${args.matchId}`)
  return spend.ok ? { ok: true } : { ok: false, reason: spend.reason }
}

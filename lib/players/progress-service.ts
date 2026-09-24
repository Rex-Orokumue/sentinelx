import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { getCoinBalance } from '@/lib/coins/service'
import { loadSeasonStanding, type SeasonStanding } from './season-standing'

const NEXT_TIER: Record<MembershipTier, MembershipTier | null> = {
  recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null,
}

export interface MyProgress {
  xp: number
  membershipTier: MembershipTier
  /** Null at the max tier. The server sends the numbers so the app never re-implements the thresholds. */
  tierProgress: { current: MembershipTier; next: MembershipTier; xpIntoTier: number; xpForNextTier: number } | null
  sxScore: number
  sentinelTier: string | null
  coinBalance: number
  seasonStanding: SeasonStanding | null
}

// Owner-only. `getAdmin` (service role) is used for exactly two reads — the coin balance and the season standing —
// both keyed by `userId`, which must come from the verified session, never from a request body.
export async function getMyProgress(
  userClient: SupabaseClient<Database>,
  getAdmin: () => Parameters<typeof getCoinBalance>[0],
  userId: string,
  now: Date = new Date(),
): Promise<MyProgress | null> {
  const { data: p } = await userClient.from('profiles').select('xp, sx_score, sentinel_tier').eq('id', userId).maybeSingle()
  if (!p) return null

  // Same derivation as the web XPProgressPanel: the tier is computed from xp.
  const tier = computeTier(p.xp)
  const next = NEXT_TIER[tier]
  const [coinBalance, seasonStanding] = await Promise.all([
    getCoinBalance(getAdmin(), userId),
    loadSeasonStanding(userClient, getAdmin, userId, true, now),
  ])
  return {
    xp: p.xp,
    membershipTier: tier,
    tierProgress: next
      ? { current: tier, next, xpIntoTier: p.xp - TIER_XP_THRESHOLDS[tier], xpForNextTier: TIER_XP_THRESHOLDS[next] - TIER_XP_THRESHOLDS[tier] }
      : null,
    sxScore: p.sx_score,
    sentinelTier: p.sentinel_tier,
    coinBalance,
    seasonStanding,
  }
}

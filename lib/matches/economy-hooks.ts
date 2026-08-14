import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

async function alreadyPaid(admin: Admin, playerId: string, source: string, matchId: string): Promise<boolean> {
  const { data } = await admin
    .from('sx_coin_transactions')
    .select('id')
    .eq('player_id', playerId)
    .eq('source', source)
    .eq('reference_id', matchId)
  return (data?.length ?? 0) > 0
}

// Called right after syncMatchEvents(admin, matchId) — reads back the exact
// sx_score_events rows that call just wrote (design doc §3.2: "match played
// +20... match won +30 bonus... stacks... no-show: no coins"). Dedup-safe
// via a ledger existence check per (player, source, matchId), since this can
// run more than once for the same match (declareNoShowWinner is documented
// as also a correction path for an already-resolved match).
export async function awardMatchEconomy(admin: Admin, matchId: string): Promise<void> {
  const { data: events } = await admin
    .from('sx_score_events')
    .select('player_id, event_type')
    .eq('match_id', matchId)
    .in('event_type', ['match_completed', 'win_no_dispute'])
  const rows = events ?? []

  const completedPlayerIds = rows.filter((e) => e.event_type === 'match_completed').map((e) => e.player_id)
  const winnerIds = rows.filter((e) => e.event_type === 'win_no_dispute').map((e) => e.player_id)

  for (const playerId of completedPlayerIds) {
    if (!(await alreadyPaid(admin, playerId, 'match_played', matchId))) {
      await awardCoins(admin, playerId, 20, 'match_played', matchId)
      await awardXP(admin, playerId, 50, 'match_played', matchId)
    }
  }
  for (const playerId of winnerIds) {
    if (!(await alreadyPaid(admin, playerId, 'match_won', matchId))) {
      await awardCoins(admin, playerId, 30, 'match_won', matchId)
      await awardXP(admin, playerId, 50, 'match_won', matchId)
    }
  }

  for (const playerId of completedPlayerIds) {
    await checkAndUnlockAchievements(admin, playerId, {
      type: 'match_completed',
      matchId,
      won: winnerIds.includes(playerId),
    })
  }
}

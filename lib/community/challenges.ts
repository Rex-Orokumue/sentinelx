import { recordCoinTransaction } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type ChallengeType = 'matches_played' | 'matches_won' | 'post_created' | 'reactions_given'

// Weekly challenges reset Monday 00:00 WAT (spec §8). Returns that Monday as
// a 'YYYY-MM-DD' date string — the week_start every progress row for the
// current week shares, matching player_challenge_progress's
// UNIQUE(player_id, challenge_id, week_start).
export function currentWeekStart(now: Date = new Date()): string {
  const wat = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const day = wat.getDay() // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1
  wat.setDate(wat.getDate() - diffToMonday)
  return wat.toLocaleDateString('sv-SE') // 'YYYY-MM-DD'
}

// Increments every community_challenges row of the given type by `amount`
// for one player's current week, awarding coins/XP exactly once when
// progress first reaches the goal (rewarded_at gates the award — retries
// and re-fires are safe). Called from the same Server Actions that trigger
// the underlying event (match confirmed, post created, reaction added) —
// spec §8 "Progress tracking".
export async function incrementChallenge(
  admin: Admin,
  playerId: string,
  challengeType: ChallengeType,
  amount = 1,
): Promise<void> {
  const { data: challenges } = await admin
    .from('community_challenges')
    .select('id, goal, coin_reward, xp_reward')
    .eq('challenge_type', challengeType)
  const weekStart = currentWeekStart()

  for (const challenge of challenges ?? []) {
    const { data: existing } = await admin
      .from('player_challenge_progress')
      .select('id, progress, completed, rewarded_at')
      .eq('player_id', playerId)
      .eq('challenge_id', challenge.id)
      .eq('week_start', weekStart)
      .maybeSingle()

    if (existing?.rewarded_at) continue // already completed + rewarded this week

    const newProgress = (existing?.progress ?? 0) + amount
    const nowCompleted = newProgress >= challenge.goal

    if (existing) {
      await admin
        .from('player_challenge_progress')
        .update({ progress: newProgress, completed: nowCompleted })
        .eq('id', existing.id)
    } else {
      await admin.from('player_challenge_progress').insert({
        player_id: playerId,
        challenge_id: challenge.id,
        week_start: weekStart,
        progress: newProgress,
        completed: nowCompleted,
      })
    }

    if (nowCompleted) {
      // Re-check rewarded_at hasn't been set by a concurrent call between the
      // read above and here — UNIQUE + this guard keeps the award idempotent.
      const { data: row } = await admin
        .from('player_challenge_progress')
        .select('id, rewarded_at')
        .eq('player_id', playerId)
        .eq('challenge_id', challenge.id)
        .eq('week_start', weekStart)
        .maybeSingle()
      if (!row || row.rewarded_at) continue

      await admin.from('player_challenge_progress').update({ rewarded_at: new Date().toISOString() }).eq('id', row.id)
      if (challenge.coin_reward > 0) await recordCoinTransaction(admin, playerId, challenge.coin_reward, 'weekly_challenge', challenge.id)
      if (challenge.xp_reward > 0) await awardXP(admin, playerId, challenge.xp_reward, 'weekly_challenge', challenge.id)
    }
  }
}

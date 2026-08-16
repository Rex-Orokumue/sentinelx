import type { createAdminClient } from '@/lib/supabase/admin'
import { recordCoinTransaction } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { notifyInApp } from '@/lib/notifications/inbox'
import { createAchievementPost } from '@/lib/community/feed-hooks'
import { REFERRAL_BASE_REWARD_COINS, pickMilestone } from './constants'

type Admin = ReturnType<typeof createAdminClient>

interface MilestoneAchievement {
  id: string
  slug: string
  name: string
  description: string
  category: string
  xp_reward: number
  coin_reward: number
  share_to_feed: boolean
}

// Idempotency: player_achievements' UNIQUE(player_id, achievement_id)
// constraint is the real guard here — same pattern as
// lib/achievements/unlock.ts's unlock(). A race between two concurrent
// settleReferral calls hitting the same milestone results in one insert
// succeeding and one failing; only the winner awards coins/XP.
async function awardMilestone(admin: Admin, referrerId: string, achievementSlug: string): Promise<void> {
  const { data: achievement } = await admin
    .from('achievements')
    .select('id, slug, name, description, category, xp_reward, coin_reward, share_to_feed')
    .eq('slug', achievementSlug)
    .maybeSingle()
  if (!achievement) {
    console.error('[referrals] milestone achievement not seeded', { achievementSlug })
    return
  }
  const a = achievement as MilestoneAchievement

  const { error: insertErr } = await admin
    .from('player_achievements')
    .insert({ player_id: referrerId, achievement_id: a.id })
  if (insertErr) return // already unlocked (unique violation) — skip silently, do not double-award

  if (a.coin_reward > 0) {
    await recordCoinTransaction(admin, referrerId, a.coin_reward, 'referral_milestone', a.id, `${a.name} — referral milestone bonus`)
  }
  if (a.xp_reward > 0) {
    await awardXP(admin, referrerId, a.xp_reward, 'achievement_unlocked', a.id)
  }
  if (a.share_to_feed) {
    // Non-blocking — the milestone is unlocked and awarded above regardless
    // of whether the feed post succeeds (same contract as unlock.ts).
    try {
      await createAchievementPost(admin, referrerId, a)
    } catch (err) {
      console.error('[referrals] createAchievementPost failed (non-blocking)', { referrerId, achievementId: a.id, err })
    }
  }
  await notifyInApp({
    playerId: referrerId,
    type: 'achievement_unlocked',
    title: 'Referral milestone!',
    body: `${a.name} — +${a.xp_reward} XP, +${a.coin_reward} SX Coins.`,
    link: '/dashboard/referrals',
  })
}

// Settles a referral that just converted: awards the base coin reward to the
// referrer, then checks whether their new converted-referral count hits a
// milestone. Never throws — callers run this inside payment confirmation and
// a bookkeeping failure here must not fail a registration already charged.
export async function settleReferral(
  admin: Admin,
  referralId: string,
  referrerId: string,
  referredPlayerId: string,
): Promise<void> {
  try {
    const { data: referredProfile } = await admin
      .from('profiles')
      .select('display_name, username')
      .eq('id', referredPlayerId)
      .maybeSingle()
    const referredName = referredProfile?.display_name ?? referredProfile?.username ?? 'a player you referred'

    await recordCoinTransaction(
      admin,
      referrerId,
      REFERRAL_BASE_REWARD_COINS,
      'referral_reward',
      referralId,
      `Referral reward — ${referredName} completed first registration`,
    )
    await admin.from('referrals').update({ coins_awarded: REFERRAL_BASE_REWARD_COINS }).eq('id', referralId)

    await notifyInApp({
      playerId: referrerId,
      type: 'referral_credited',
      title: 'Referral credited',
      body: `${referredName} just competed for the first time — +${REFERRAL_BASE_REWARD_COINS} SX Coins added.`,
      link: '/dashboard/referrals',
    })

    const { count: convertedCount } = await admin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .eq('status', 'converted')

    const milestone = pickMilestone(convertedCount ?? 0)
    if (milestone) await awardMilestone(admin, referrerId, milestone.achievementSlug)
  } catch (err) {
    console.error('[referrals] settleReferral threw', {
      referralId,
      referrerId,
      referredPlayerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

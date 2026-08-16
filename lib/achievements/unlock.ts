import { awardXP } from '@/lib/membership/xp'
import { recordCoinTransaction } from '@/lib/coins/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { createAchievementPost } from '@/lib/community/feed-hooks'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type AchievementContext =
  | { type: 'match_completed'; matchId: string; won: boolean }
  | { type: 'tournament_completed'; tournamentId: string; placement: number; tournamentType: string }
  | { type: 'sx_score_updated'; newScore: number }
  | { type: 'profile_updated' }
  | { type: 'season_completed'; season: string } // not yet fired anywhere — see Task 4.3 note

interface AchievementRow {
  id: string
  slug: string
  name: string
  description: string
  category: string
  xp_reward: number
  coin_reward: number
  share_to_feed: boolean
}

const SCORE_THRESHOLDS: [string, number][] = [
  ['sx_score_100', 100],
  ['sx_score_500', 500],
  ['sx_score_1000', 1000],
  ['sx_score_5000', 5000],
]

async function unlockedSlugSet(admin: Admin, playerId: string): Promise<Set<string>> {
  const { data } = await admin.from('player_achievements').select('achievement_id').eq('player_id', playerId)
  return new Set((data ?? []).map((r) => r.achievement_id as string))
}

async function candidateAchievements(admin: Admin, category: string): Promise<AchievementRow[]> {
  const { data } = await admin
    .from('achievements')
    .select('id, slug, name, description, category, xp_reward, coin_reward, share_to_feed')
    .eq('category', category)
    .eq('phase', 'phase2')
  return (data ?? []) as AchievementRow[]
}

async function unlock(admin: Admin, playerId: string, achievement: AchievementRow): Promise<void> {
  const { error: insertErr } = await admin
    .from('player_achievements')
    .insert({ player_id: playerId, achievement_id: achievement.id })
  if (insertErr) {
    // UNIQUE(player_id, achievement_id) race — someone else's concurrent call
    // already unlocked this. Skip silently; do not double-award.
    return
  }
  if (achievement.xp_reward > 0) await awardXP(admin, playerId, achievement.xp_reward, 'achievement_unlocked', achievement.id)
  if (achievement.coin_reward > 0) await recordCoinTransaction(admin, playerId, achievement.coin_reward, 'achievement_unlocked', achievement.id)
  if (achievement.share_to_feed) {
    // Non-blocking — an achievement is unlocked and awarded above regardless
    // of whether the feed post succeeds (same non-blocking contract as the
    // match_result hook in feed-hooks.ts#onMatchConfirmed).
    try {
      await createAchievementPost(admin, playerId, achievement)
    } catch (err) {
      console.error('[unlock] createAchievementPost failed (non-blocking)', { playerId, achievementId: achievement.id, err })
    }
  }
  await notifyInApp({
    playerId,
    type: 'achievement_unlocked',
    title: 'Achievement unlocked!',
    body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.`,
    link: `/dashboard`,
  })
}

async function unlockIfDue(
  admin: Admin,
  playerId: string,
  already: Set<string>,
  candidates: AchievementRow[],
  isDue: (slug: string) => boolean,
): Promise<void> {
  for (const a of candidates) {
    if (already.has(a.id)) continue
    if (isDue(a.slug)) await unlock(admin, playerId, a)
  }
}

export async function checkAndUnlockAchievements(admin: Admin, playerId: string, context: AchievementContext): Promise<void> {
  const already = await unlockedSlugSet(admin, playerId)

  if (context.type === 'match_completed') {
    const { data: profile } = await admin.from('profiles').select('total_matches, wins').eq('id', playerId).maybeSingle()
    const totalMatches = profile?.total_matches ?? 0
    const wins = profile?.wins ?? 0
    const candidates = await candidateAchievements(admin, 'matches')

    let streak = 0
    if (context.won) {
      const { data: recent } = await admin
        .from('matches')
        .select('player_a_id, player_b_id, score_a, score_b, completed_at')
        .eq('status', 'completed')
        .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
        .order('completed_at', { ascending: false })
        .limit(10)
      for (const m of recent ?? []) {
        const isA = m.player_a_id === playerId
        const mine = isA ? m.score_a : m.score_b
        const theirs = isA ? m.score_b : m.score_a
        if (mine == null || theirs == null || mine <= theirs) break
        streak++
      }
    }

    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      if (slug === 'first_match') return totalMatches >= 1
      if (slug === 'matches_10') return totalMatches >= 10
      if (slug === 'matches_50') return totalMatches >= 50
      if (slug === 'matches_100') return totalMatches >= 100
      if (slug === 'first_win') return context.won && wins >= 1
      if (slug === 'wins_10') return context.won && wins >= 10
      if (slug === 'wins_50') return context.won && wins >= 50
      if (slug === 'win_streak_3') return context.won && streak >= 3
      if (slug === 'win_streak_5') return context.won && streak >= 5
      return false
    })
    return
  }

  if (context.type === 'tournament_completed') {
    const candidates = await candidateAchievements(admin, 'tournaments')
    const { count: championCount } = await admin
      .from('season_ranking_points')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('placement', 1)

    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      if (slug === 'first_tournament') return true
      if (slug === 'first_podium') return context.placement <= 3
      if (slug === 'first_champion') return context.placement === 1
      if (slug === 'champion_3x') return context.placement === 1 && (championCount ?? 0) >= 3
      if (slug === 'masters_qualifier') return context.tournamentType === 'masters'
      if (slug === 'masters_champion') return context.tournamentType === 'masters' && context.placement === 1
      if (slug === 'champions_cup_qualifier') return context.tournamentType === 'champions_cup'
      if (slug === 'champions_cup_champion') return context.tournamentType === 'champions_cup' && context.placement === 1
      return false
    })

    const seasonCandidates = await candidateAchievements(admin, 'season')
    await unlockIfDue(admin, playerId, already, seasonCandidates, (slug) => {
      // season_top_100/season_top_10/season_month_sweep are deliberately not
      // evaluated here — see Global Constraints #6 and the note above Task 4.3.
      if (slug === 'season_participant') return context.tournamentType === 'community_club'
      return false
    })
    return
  }

  if (context.type === 'sx_score_updated') {
    const candidates = await candidateAchievements(admin, 'score')
    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      const threshold = SCORE_THRESHOLDS.find(([s]) => s === slug)?.[1]
      return threshold != null && context.newScore >= threshold
    })
    return
  }

  if (context.type === 'profile_updated') {
    const { data: profile } = await admin
      .from('profiles')
      .select('avatar_url, bio, phone_verified_at')
      .eq('id', playerId)
      .maybeSingle()
    const candidates = await candidateAchievements(admin, 'profile')
    await unlockIfDue(admin, playerId, already, candidates, (slug) => {
      if (slug === 'profile_complete') return !!profile?.avatar_url && !!profile?.bio
      if (slug === 'phone_verified') return !!profile?.phone_verified_at
      return false
    })
    return
  }

  // 'season_completed' — no-op in this phase; see Global Constraints #6.
}

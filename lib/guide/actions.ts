'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardXP } from '@/lib/membership/xp'
import { recordCoinTransaction } from '@/lib/coins/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { computeQuestStatus, type QuestStatus } from './quest-status'

type Admin = ReturnType<typeof createAdminClient>

const BATTLE_READY_SLUG = 'battle_ready'

// Shared by both actions below — one Supabase round-trip shape, one place
// that knows which columns/tables back each quest step.
async function fetchStatus(admin: Admin, playerId: string): Promise<QuestStatus> {
  const [{ data: profile }, { count: registrationCount }] = await Promise.all([
    admin.from('profiles').select('username, avatar_url, total_matches').eq('id', playerId).maybeSingle(),
    admin
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('payment_status', 'paid'),
  ])
  return computeQuestStatus({
    hasUsername: !!profile?.username,
    hasAvatar: !!profile?.avatar_url,
    hasPaidRegistration: (registrationCount ?? 0) > 0,
    totalMatches: profile?.total_matches ?? 0,
  })
}

export async function getQuestStatus(): Promise<
  { ok: true; status: QuestStatus; alreadyClaimed: boolean } | { ok: false; error: string }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  const admin = createAdminClient()
  const status = await fetchStatus(admin, user.id)

  const { data: achievement } = await admin.from('achievements').select('id').eq('slug', BATTLE_READY_SLUG).maybeSingle()
  let alreadyClaimed = false
  if (achievement) {
    const { data: unlocked } = await admin
      .from('player_achievements')
      .select('id')
      .eq('player_id', user.id)
      .eq('achievement_id', achievement.id)
      .maybeSingle()
    alreadyClaimed = !!unlocked
  }

  return { ok: true, status, alreadyClaimed }
}

export async function claimBattleReadyBadge(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  const admin = createAdminClient()
  // Re-verify server-side — never trust the client's cached quest state
  // (Global Constraints: a stale second tab could call claim early).
  const status = await fetchStatus(admin, user.id)
  if (!status.allComplete) return { ok: false, error: 'Complete all 3 quest steps first.' }

  const { data: achievement } = await admin
    .from('achievements')
    .select('id, name, xp_reward, coin_reward')
    .eq('slug', BATTLE_READY_SLUG)
    .maybeSingle()
  if (!achievement) return { ok: false, error: 'Reward unavailable right now.' }

  const { error: insertErr } = await admin
    .from('player_achievements')
    .insert({ player_id: user.id, achievement_id: achievement.id })
  if (insertErr) {
    // UNIQUE(player_id, achievement_id) — already claimed (double-click or
    // another tab beat this call). Not a failure from the caller's
    // perspective; they already hold the badge. Mirrors unlock()'s own
    // race handling in lib/achievements/unlock.ts.
    return { ok: true }
  }

  await awardXP(admin, user.id, achievement.xp_reward, 'achievement_unlocked', achievement.id)
  await recordCoinTransaction(admin, user.id, achievement.coin_reward, 'achievement_unlocked', achievement.id)
  await notifyInApp({
    playerId: user.id,
    type: 'achievement_unlocked',
    title: 'Achievement unlocked!',
    body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.`,
    link: '/dashboard',
  })
  void pushToPlayer(
    user.id,
    'achievement_unlocked',
    { title: 'Achievement unlocked!', body: `${achievement.name} — +${achievement.xp_reward} XP, +${achievement.coin_reward} SX Coins.` },
    { url: '/dashboard' },
  )

  return { ok: true }
}

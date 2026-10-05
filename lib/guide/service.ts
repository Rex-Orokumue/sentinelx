import type { createAdminClient } from '@/lib/supabase/admin'
import { awardXP } from '@/lib/membership/xp'
import { recordCoinTransaction } from '@/lib/coins/service'
import { notifyBoth } from '@/lib/notifications/send'
import { computeQuestStatus, type QuestStatus } from './quest-status'

type Admin = ReturnType<typeof createAdminClient>
const SLUG = 'battle_ready'
const LEASE_MS = 2 * 60_000

export type QuestTarget = 'edit_profile' | 'tournaments' | 'matches'
export interface QuestStepDto { key: 'profile_complete' | 'first_tournament_entered' | 'first_match_completed'; done: boolean; target: QuestTarget }
export interface QuestDto {
  id: 'battle_ready'
  steps: QuestStepDto[]
  doneCount: number
  totalCount: 3
  allComplete: boolean
  claimed: boolean
  reward: { xp: number; coins: number }
}

export class ClaimError extends Error {
  constructor(public code: 'quest_incomplete' | 'reward_unavailable' | 'claim_in_progress') {
    super(code)
  }
}

// One Supabase round-trip shape, one place that knows which columns/tables back each quest step.
export async function fetchStatus(admin: Admin, playerId: string): Promise<QuestStatus> {
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

async function loadAchievement(admin: Admin) {
  const { data } = await admin.from('achievements').select('id, name, xp_reward, coin_reward').eq('slug', SLUG).maybeSingle()
  return data
}

export async function getQuests(admin: Admin, userId: string): Promise<QuestDto[]> {
  const [status, ach] = await Promise.all([fetchStatus(admin, userId), loadAchievement(admin)])
  let claimed = false
  if (ach) {
    const { data } = await admin
      .from('player_achievements')
      .select('rewards_granted_at')
      .eq('player_id', userId)
      .eq('achievement_id', ach.id)
      .maybeSingle()
    claimed = !!data?.rewards_granted_at
  }
  const steps: QuestStepDto[] = [
    { key: 'profile_complete', done: status.profileComplete, target: 'edit_profile' },
    { key: 'first_tournament_entered', done: status.firstTournamentEntered, target: 'tournaments' },
    { key: 'first_match_completed', done: status.firstMatchCompleted, target: 'matches' },
  ]
  return [
    {
      id: 'battle_ready',
      steps,
      doneCount: steps.filter((s) => s.done).length,
      totalCount: 3,
      allComplete: status.allComplete,
      claimed,
      reward: { xp: ach?.xp_reward ?? 0, coins: ach?.coin_reward ?? 0 },
    },
  ]
}

// The player_achievements row (UNIQUE per player+achievement) is the claim lock. It carries a lease and
// rewards_granted_at (NULL until the claim completes). Each award is skipped when its ledger row already exists,
// so a retry after a failure resumes only the missing steps. Residual risk: a crash inside awardXP between its
// profiles.xp update and its xp_events insert is undetectable.
export async function claimBattleReady(admin: Admin, userId: string, now: () => Date = () => new Date()) {
  const status = await fetchStatus(admin, userId)
  if (!status.allComplete) throw new ClaimError('quest_incomplete')
  const ach = await loadAchievement(admin)
  if (!ach) throw new ClaimError('reward_unavailable')
  const leaseUntil = () => new Date(now().getTime() + LEASE_MS).toISOString()
  const done = { claimed: true as const, xp: ach.xp_reward, coins: ach.coin_reward }

  // 1. Take the claim.
  const { error: insErr } = await admin.from('player_achievements').insert({
    player_id: userId, achievement_id: ach.id, rewards_granted_at: null, reward_lease_until: leaseUntil(),
  } as never)
  if (insErr) {
    if ((insErr as { code?: string }).code !== '23505') throw insErr
    const { data: row } = await admin
      .from('player_achievements')
      .select('id, rewards_granted_at')
      .eq('player_id', userId)
      .eq('achievement_id', ach.id)
      .maybeSingle()
    if (row?.rewards_granted_at) return { ...done, alreadyClaimed: true }
    // An earlier claim never finished. Take the lease atomically; only one caller can.
    const { data: took } = await admin
      .from('player_achievements')
      .update({ reward_lease_until: leaseUntil() } as never)
      .eq('id', row!.id)
      .is('rewards_granted_at', null)
      .or(`reward_lease_until.is.null,reward_lease_until.lt.${now().toISOString()}`)
      .select('id')
    if (!took || took.length === 0) throw new ClaimError('claim_in_progress')
  }

  // 2. Grant the missing steps. Each is skipped when its ledger row already exists.
  const { data: xpRow } = await admin
    .from('xp_events')
    .select('id')
    .eq('player_id', userId)
    .eq('source', 'achievement_unlocked')
    .eq('reference_id', ach.id)
    .limit(1)
  if (!xpRow || xpRow.length === 0) await awardXP(admin, userId, ach.xp_reward, 'achievement_unlocked', ach.id)
  const { data: coinRow } = await admin
    .from('sx_coin_transactions')
    .select('id')
    .eq('player_id', userId)
    .eq('source', 'achievement_unlocked')
    .eq('reference_id', ach.id)
    .limit(1)
  if (!coinRow || coinRow.length === 0) await recordCoinTransaction(admin, userId, ach.coin_reward, 'achievement_unlocked', ach.id)

  // 3. Seal the claim, then notify (best effort).
  await admin
    .from('player_achievements')
    .update({ rewards_granted_at: now().toISOString(), reward_lease_until: null } as never)
    .eq('player_id', userId)
    .eq('achievement_id', ach.id)
  void notifyBoth(
    userId,
    { type: 'achievement_unlocked', name: ach.name, xp: ach.xp_reward, coins: ach.coin_reward },
    'achievement_unlocked',
    { link: '/dashboard' },
  ).catch(() => {})
  return { ...done, alreadyClaimed: false }
}

import { ROUND_LABELS } from '@/lib/tournaments/bracket'
import { formatDate } from '@/lib/format'
import { incrementChallenge } from './challenges'
import { matchRosters } from '@/lib/tournaments/squad-roster'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? (x[0] ?? null) : x
  return r?.display_name ?? r?.username ?? 'Player'
}
type SquadRef = { name: string } | { name: string }[] | null
function squadNameOf(x: SquadRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.name ?? 'Squad'
}

// Spec §10 — runs inside confirmResult() right after the result is saved.
// Non-blocking: every step is wrapped by the caller in try/catch (see
// verify-actions.ts) so a feed/challenge failure never blocks a result
// confirmation from going through.
interface MatchRow {
  id: string
  round: string
  score_a: number | null
  score_b: number | null
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  player_a: NameRef
  player_b: NameRef
  team_a: SquadRef
  team_b: SquadRef
  tournament: { title: string } | { title: string }[] | null
}

export async function onMatchConfirmed(admin: Admin, matchId: string): Promise<void> {
  const { data: mRaw } = await admin
    .from('matches')
    .select(
      'id, round, score_a, score_b, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'team_a:squads!matches_team_a_id_fkey(name), ' +
        'team_b:squads!matches_team_b_id_fkey(name), ' +
        'tournament:tournaments(title)',
    )
    .eq('id', matchId)
    .maybeSingle()
  const m = mRaw as unknown as MatchRow | null
  if (!m || m.score_a == null || m.score_b == null) return
  const isTeam = !!(m.team_a_id || m.team_b_id)
  if (!isTeam && (!m.player_a_id || !m.player_b_id)) return
  if (isTeam && (!m.team_a_id || !m.team_b_id)) return

  type TournamentRef = { title: string } | { title: string }[] | null
  const t = m.tournament as TournamentRef
  const title = (Array.isArray(t) ? t[0]?.title : t?.title) ?? 'SentinelX'
  const aName = isTeam ? squadNameOf(m.team_a) : nameOf(m.player_a as NameRef)
  const bName = isTeam ? squadNameOf(m.team_b) : nameOf(m.player_b as NameRef)
  const roundLabel = ROUND_LABELS[m.round] ?? m.round
  const dateLabel = formatDate(m.scheduled_at) ?? ''

  const content =
    `🏆 Match Result — ${title}\n` +
    `${aName} ${m.score_a} – ${m.score_b} ${bName}\n` +
    `${roundLabel}${dateLabel ? ` · ${dateLabel}` : ''}`

  const { error } = await admin.from('community_posts').insert({
    post_type: 'match_result',
    reference_id: matchId,
    author_id: null,
    content,
  })
  if (error) {
    console.error('[onMatchConfirmed] community_posts insert failed', { matchId, code: error.code, message: error.message })
  }

  if (isTeam) {
    const { rosterA, rosterB } = await matchRosters(admin, m.team_a_id, m.team_b_id)
    const winnerRoster = m.score_a > m.score_b ? rosterA : m.score_b > m.score_a ? rosterB : []
    for (const pid of [...rosterA, ...rosterB]) await incrementChallenge(admin, pid, 'matches_played')
    for (const pid of winnerRoster) await incrementChallenge(admin, pid, 'matches_won')
    return
  }

  const winnerId = m.score_a > m.score_b ? m.player_a_id : m.score_b > m.score_a ? m.player_b_id : null
  await incrementChallenge(admin, m.player_a_id as string, 'matches_played')
  await incrementChallenge(admin, m.player_b_id as string, 'matches_played')
  if (winnerId) await incrementChallenge(admin, winnerId, 'matches_won')
}

// Spec §2 "Achievement Auto-Post" — called from lib/achievements/unlock.ts
// only when the achievement's share_to_feed is true. Player display name is
// looked up fresh rather than threaded through the caller — unlock() doesn't
// otherwise need it.
export async function createAchievementPost(
  admin: Admin,
  playerId: string,
  achievement: { id: string; name: string; description: string; xp_reward: number; coin_reward: number },
): Promise<void> {
  const { data: profile } = await admin.from('profiles').select('display_name, username').eq('id', playerId).maybeSingle()
  const name = profile?.display_name ?? profile?.username ?? 'A player'

  const content =
    `👑 ${name} just unlocked "${achievement.name}"!\n` +
    `${achievement.description}\n` +
    `+${achievement.xp_reward} XP · +${achievement.coin_reward} coins`

  const { error } = await admin.from('community_posts').insert({
    post_type: 'achievement',
    reference_id: achievement.id,
    author_id: playerId,
    content,
  })
  if (error) {
    console.error('[createAchievementPost] community_posts insert failed', { playerId, achievementId: achievement.id, code: error.code, message: error.message })
  }
}

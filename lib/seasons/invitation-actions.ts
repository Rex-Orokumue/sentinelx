'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { getMonthlyLeaderboard, getSeasonLeaderboard } from './data'
import { selectInvitees, type LeaderboardEntry } from './eligibility'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { mastersInviteKey } from '@/lib/notifications/keys'

type Admin = ReturnType<typeof createAdminClient>

const INVITE_SLOTS = 16
const RESPONSE_WINDOW_HOURS = 48

export type InvitationActionState = { error?: string; success?: boolean; invited?: number } | undefined

interface InvitableTournament {
  id: string
  title: string
  tournament_type: string
  season_id: string | null
  tournament_start: string | null
  registration_fee: number
}

async function tournamentForInvitations(admin: Admin, tournamentId: string): Promise<InvitableTournament | null> {
  const { data } = await admin
    .from('tournaments')
    .select('id, title, tournament_type, season_id, tournament_start, registration_fee')
    .eq('id', tournamentId)
    .maybeSingle()
  return data
}

async function leaderboardFor(admin: Admin, tournament: InvitableTournament): Promise<LeaderboardEntry[]> {
  if (!tournament.season_id) return []
  const rows =
    tournament.tournament_type === 'masters'
      ? await getMonthlyLeaderboard(admin, tournament.season_id, new Date(tournament.tournament_start ?? Date.now()))
      : await getSeasonLeaderboard(admin, tournament.season_id)
  return rows.map((r) => ({ playerId: r.playerId, points: r.points, sentinelScore: r.sentinelScore }))
}

async function acceptedCount(admin: Admin, tournamentId: string): Promise<number> {
  const { count } = await admin
    .from('tournament_invitations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('status', 'accepted')
  return count ?? 0
}

async function invitedPlayerIds(admin: Admin, tournamentId: string): Promise<Set<string>> {
  const { data } = await admin.from('tournament_invitations').select('player_id').eq('tournament_id', tournamentId)
  return new Set((data ?? []).map((r) => r.player_id))
}

async function sendInvitationRows(
  admin: Admin,
  tournament: InvitableTournament,
  playerIds: string[],
  rankByPlayer: Map<string, number>,
  notificationType: 'masters_invitation' | 'champions_cup_invitation' | 'invitation_expired_cascade',
): Promise<void> {
  if (playerIds.length === 0) return
  const expiresAt = new Date(Date.now() + RESPONSE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const rows = playerIds.map((playerId) => ({
    tournament_id: tournament.id,
    player_id: playerId,
    rank_at_invite: rankByPlayer.get(playerId) ?? 0,
    status: 'pending' as const,
    expires_at: expiresAt,
  }))
  await admin.from('tournament_invitations').insert(rows)

  const entryFee = tournament.registration_fee > 0 ? `₦${tournament.registration_fee.toLocaleString()}` : 'Free'
  for (const playerId of playerIds) {
    const rank = rankByPlayer.get(playerId) ?? 0
    await notify({
      type: notificationType,
      playerId,
      dedupeKey: mastersInviteKey(tournament.id, playerId),
      tournamentName: tournament.title,
      rank,
      deadline: expiresAt,
      entryFee,
    })
    await notifyInApp({
      playerId,
      type: notificationType,
      title: `You've been invited to ${tournament.title}!`,
      body: `You ranked #${rank}. Respond within 48 hours to secure your spot.`,
      link: '/dashboard',
    })
  }
}

// Admin "Send Invitations" button — first send only; errors if any
// invitation already exists for this tournament (use the cascade path to
// top up afterward, not a second full send).
export async function sendInvitations(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const tournament = await tournamentForInvitations(admin, tournamentId)
  if (!tournament) return { error: 'Tournament not found.' }
  if (tournament.tournament_type !== 'masters' && tournament.tournament_type !== 'champions_cup') {
    return { error: 'Invitations only apply to Masters and Champions Cup tournaments.' }
  }
  const invited = await invitedPlayerIds(admin, tournamentId)
  if (invited.size > 0) return { error: 'Invitations have already been sent for this tournament.' }

  const leaderboard = await leaderboardFor(admin, tournament)
  const selected = selectInvitees(leaderboard, invited, INVITE_SLOTS)
  const rankByPlayer = new Map(leaderboard.map((e, i) => [e.playerId, i + 1]))
  const notificationType = tournament.tournament_type === 'masters' ? 'masters_invitation' : 'champions_cup_invitation'
  await sendInvitationRows(admin, tournament, selected, rankByPlayer, notificationType)

  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true, invited: selected.length }
}

// Tops one tournament back up toward 16 accepted invitees from whoever's
// next on the leaderboard and hasn't been invited yet. Shared by decline,
// the expiry cron, and the admin's manual cascade button.
export async function cascadeNextInvitation(admin: Admin, tournamentId: string): Promise<{ invited: number }> {
  const tournament = await tournamentForInvitations(admin, tournamentId)
  if (!tournament || (tournament.tournament_type !== 'masters' && tournament.tournament_type !== 'champions_cup')) {
    return { invited: 0 }
  }
  const accepted = await acceptedCount(admin, tournamentId)
  const openSlots = INVITE_SLOTS - accepted
  if (openSlots <= 0) return { invited: 0 }

  const invited = await invitedPlayerIds(admin, tournamentId)
  const leaderboard = await leaderboardFor(admin, tournament)
  const selected = selectInvitees(leaderboard, invited, openSlots)
  const rankByPlayer = new Map(leaderboard.map((e, i) => [e.playerId, i + 1]))
  await sendInvitationRows(admin, tournament, selected, rankByPlayer, 'invitation_expired_cascade')
  return { invited: selected.length }
}

// Expires everything past its deadline platform-wide, then tops up every
// affected tournament. Called by the daily cron (Task 13) and by the
// admin's "Check & Cascade Now" button (cheap to run for all tournaments,
// not just the current one — identical to the cron's behavior).
export async function expireAndCascadeInvitations(admin: Admin): Promise<{ expired: number; invited: number }> {
  const { data: expired } = await admin
    .from('tournament_invitations')
    .update({ status: 'expired', responded_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('tournament_id')
  const tournamentIds = Array.from(new Set((expired ?? []).map((r) => r.tournament_id)))

  let invited = 0
  for (const tournamentId of tournamentIds) {
    const result = await cascadeNextInvitation(admin, tournamentId)
    invited += result.invited
  }
  return { expired: (expired ?? []).length, invited }
}

export async function triggerCascadeNow(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  const admin = createAdminClient()
  await expireAndCascadeInvitations(admin)
  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true }
}

// Bypasses the leaderboard entirely — admin picks a specific player by
// username, for edge cases the automated flow can't handle.
export async function manuallyAddInvitee(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const username = String(formData.get('username') ?? '').trim()
  if (!tournamentId || !username) return { error: 'Missing tournament or username.' }

  const admin = createAdminClient()
  const { data: player } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (!player) return { error: `No player found with username "${username}".` }

  const expiresAt = new Date(Date.now() + RESPONSE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { error } = await admin.from('tournament_invitations').insert({
    tournament_id: tournamentId,
    player_id: player.id,
    rank_at_invite: 0,
    status: 'pending',
    expires_at: expiresAt,
  })
  if (error) {
    return { error: error.code === '23505' ? 'This player already has an invitation.' : 'Could not add this player.' }
  }
  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true }
}

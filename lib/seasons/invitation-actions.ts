'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { getMastersQualificationLeaderboard, getSeasonLeaderboard } from './data'
import { planInvitations, type LeaderboardEntry } from './eligibility'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { mastersInviteKey, mastersReinviteKey } from '@/lib/notifications/keys'

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
  game_id: string
}

type InvitationNotificationType = 'masters_invitation' | 'champions_cup_invitation' | 'invitation_expired_cascade'

async function tournamentForInvitations(admin: Admin, tournamentId: string): Promise<InvitableTournament | null> {
  const { data } = await admin
    .from('tournaments')
    .select('id, title, tournament_type, season_id, tournament_start, registration_fee, game_id')
    .eq('id', tournamentId)
    .maybeSingle()
  return data
}

function isInvitable(tournament: InvitableTournament | null): tournament is InvitableTournament {
  return tournament !== null && (tournament.tournament_type === 'masters' || tournament.tournament_type === 'champions_cup')
}

async function leaderboardFor(admin: Admin, tournament: InvitableTournament): Promise<LeaderboardEntry[]> {
  if (!tournament.season_id) return []
  const rows =
    tournament.tournament_type === 'masters'
      ? await getMastersQualificationLeaderboard(admin, {
          seasonId: tournament.season_id,
          gameId: tournament.game_id,
          mastersId: tournament.id,
          mastersStart: new Date(tournament.tournament_start ?? Date.now()),
        })
      : await getSeasonLeaderboard(admin, tournament.season_id, tournament.game_id)

  // Anonymised accounts keep their stats on the leaderboard (history is retained)
  // but must never receive an invitation.
  const ids = rows.map((r) => r.playerId)
  const { data: profiles } = ids.length > 0 ? await admin.from('profiles').select('id, deleted_at').in('id', ids) : { data: [] }
  const gone = new Set((profiles ?? []).filter((p) => p.deleted_at).map((p) => p.id))
  return rows.filter((r) => !gone.has(r.playerId)).map((r) => ({ playerId: r.playerId, points: r.points, sxScore: r.sxScore }))
}

async function invitationRows(admin: Admin, tournamentId: string): Promise<{ playerId: string; status: string }[]> {
  const { data } = await admin.from('tournament_invitations').select('player_id, status').eq('tournament_id', tournamentId)
  return (data ?? []).map((r) => ({ playerId: r.player_id, status: r.status }))
}

function baseInvitationType(tournament: InvitableTournament): 'masters_invitation' | 'champions_cup_invitation' {
  return tournament.tournament_type === 'masters' ? 'masters_invitation' : 'champions_cup_invitation'
}

const newDeadline = () => new Date(Date.now() + RESPONSE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

// The one place an invitee is told. Every path that creates or revives an
// invitation row (first send, cascade, manual add, re-invite) goes through it,
// so a row can never exist without the player having been notified.
async function notifyInvitee(
  tournament: InvitableTournament,
  playerId: string,
  rank: number,
  expiresAt: string,
  type: InvitationNotificationType,
  dedupeKey: string,
): Promise<void> {
  const entryFee = tournament.registration_fee > 0 ? `₦${tournament.registration_fee.toLocaleString()}` : 'Free'
  await notify({ type, playerId, dedupeKey, tournamentName: tournament.title, rank, deadline: expiresAt, entryFee })
  await notifyInApp({
    playerId,
    type,
    title: `You've been invited to ${tournament.title}!`,
    body:
      rank > 0
        ? `You ranked #${rank}. Respond within ${RESPONSE_WINDOW_HOURS} hours to secure your spot.`
        : `You've been selected. Respond within ${RESPONSE_WINDOW_HOURS} hours to secure your spot.`,
    link: '/dashboard',
  })
}

// Inserts first, notifies only the rows that really landed. A failed insert
// throws instead of being swallowed — the previous version ignored the error
// and still reported players as invited.
async function sendInvitationRows(
  admin: Admin,
  tournament: InvitableTournament,
  playerIds: string[],
  rankByPlayer: Map<string, number>,
  notificationType: InvitationNotificationType,
): Promise<number> {
  if (playerIds.length === 0) return 0
  const expiresAt = newDeadline()
  const { data: inserted, error } = await admin
    .from('tournament_invitations')
    .insert(
      playerIds.map((playerId) => ({
        tournament_id: tournament.id,
        player_id: playerId,
        rank_at_invite: rankByPlayer.get(playerId) ?? 0,
        status: 'pending' as const,
        expires_at: expiresAt,
      })),
    )
    .select('player_id')
  if (error) throw new Error(`Could not create invitations: ${error.message}`)

  for (const row of inserted ?? []) {
    await notifyInvitee(
      tournament,
      row.player_id,
      rankByPlayer.get(row.player_id) ?? 0,
      expiresAt,
      notificationType,
      mastersInviteKey(tournament.id, row.player_id),
    )
  }
  return (inserted ?? []).length
}

// Flips expired rows back to pending with a fresh window and tells the player.
// Guarded on status='expired' so a player who responded in the meantime is untouched.
async function reviveExpiredRows(
  admin: Admin,
  tournament: InvitableTournament,
  playerIds: string[],
  rankByPlayer: Map<string, number>,
): Promise<number> {
  let revived = 0
  for (const playerId of playerIds) {
    const expiresAt = newDeadline()
    const rank = rankByPlayer.get(playerId) ?? 0
    const { data, error } = await admin
      .from('tournament_invitations')
      .update({
        status: 'pending',
        expires_at: expiresAt,
        invited_at: new Date().toISOString(),
        responded_at: null,
        rank_at_invite: rank,
      })
      .eq('tournament_id', tournament.id)
      .eq('player_id', playerId)
      .eq('status', 'expired')
      .select('player_id')
    if (error) throw new Error(`Could not re-invite a player: ${error.message}`)
    if ((data ?? []).length === 0) continue
    await notifyInvitee(tournament, playerId, rank, expiresAt, baseInvitationType(tournament), mastersReinviteKey(tournament.id, playerId, expiresAt))
    revived++
  }
  return revived
}

// Fills every open slot, strictly by rank. A slot is open unless a player holds
// it: accepted AND pending both count (previously only accepted did, so a
// cascade invited as many people as there were non-accepted slots even while a
// full set of invitations was still pending).
export async function fillInvitations(
  admin: Admin,
  tournamentId: string,
  opts: { includeExpired?: boolean; notificationType?: InvitationNotificationType } = {},
): Promise<{ invited: number; reinvited: number }> {
  const tournament = await tournamentForInvitations(admin, tournamentId)
  if (!isInvitable(tournament)) return { invited: 0, reinvited: 0 }

  const rows = await invitationRows(admin, tournamentId)
  const holding = rows.filter((r) => r.status === 'accepted' || r.status === 'pending').length
  const openSlots = INVITE_SLOTS - holding
  if (openSlots <= 0) return { invited: 0, reinvited: 0 }

  const leaderboard = await leaderboardFor(admin, tournament)
  const plan = planInvitations(leaderboard, rows, openSlots, { includeExpired: opts.includeExpired })
  const rankByPlayer = new Map(leaderboard.map((e, i) => [e.playerId, i + 1]))
  const invited = await sendInvitationRows(admin, tournament, plan.invite, rankByPlayer, opts.notificationType ?? baseInvitationType(tournament))
  const reinvited = await reviveExpiredRows(admin, tournament, plan.reinvite, rankByPlayer)
  return { invited, reinvited }
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
  if (!isInvitable(tournament)) return { error: 'Invitations only apply to Masters and Champions Cup tournaments.' }
  if ((await invitationRows(admin, tournamentId)).length > 0) {
    return { error: 'Invitations have already been sent for this tournament. Use "Check & Cascade Now" to fill open slots.' }
  }

  try {
    const { invited } = await fillInvitations(admin, tournamentId)
    revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
    return { success: true, invited }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send invitations.' }
  }
}

// Tops one tournament back up toward 16 held spots from whoever's next on the
// leaderboard and hasn't been invited yet. Shared by decline, the expiry cron,
// and the admin's manual cascade button.
export async function cascadeNextInvitation(admin: Admin, tournamentId: string): Promise<{ invited: number }> {
  const { invited } = await fillInvitations(admin, tournamentId, { notificationType: 'invitation_expired_cascade' })
  return { invited }
}

// Expires everything past its deadline platform-wide, then tops up every
// affected tournament. Called by the daily cron and by the admin's
// "Check & Cascade Now" button (cheap to run for all tournaments, not just
// the current one — identical to the cron's behavior).
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
    try {
      invited += (await cascadeNextInvitation(admin, tournamentId)).invited
    } catch (e) {
      // One tournament's failure must not stop the rest of the sweep.
      console.error('cascadeNextInvitation failed', tournamentId, e)
    }
  }
  return { expired: (expired ?? []).length, invited }
}

// Sweeps expiries, then ALSO tops up this tournament directly: the sweep alone
// only tops up tournaments that had a row expire in this very run, so an
// already-expired round (or a leaderboard that gained players since) was
// unreachable from the button.
export async function triggerCascadeNow(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  const admin = createAdminClient()
  try {
    const swept = await expireAndCascadeInvitations(admin)
    const topUp = await cascadeNextInvitation(admin, tournamentId)
    revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
    return { success: true, invited: swept.invited + topUp.invited }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not check invitations.' }
  }
}

// Recovery path: gives expired invitees a fresh window and notifies them,
// competing with never-invited players for the open slots strictly by rank.
export async function reinviteExpiredInvitations(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  const admin = createAdminClient()
  try {
    const { invited, reinvited } = await fillInvitations(admin, tournamentId, { includeExpired: true })
    revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
    return { success: true, invited: invited + reinvited }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not re-invite players.' }
  }
}

// Bypasses the leaderboard's eligibility rules — admin picks a specific player
// by username, for edge cases the automated flow can't handle. The player is
// notified exactly like an automatic invitee, and an expired invitation is
// revived rather than rejected as a duplicate.
export async function manuallyAddInvitee(_prev: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const username = String(formData.get('username') ?? '').trim()
  if (!tournamentId || !username) return { error: 'Missing tournament or username.' }

  const admin = createAdminClient()
  const tournament = await tournamentForInvitations(admin, tournamentId)
  if (!isInvitable(tournament)) return { error: 'Invitations only apply to Masters and Champions Cup tournaments.' }

  // ILIKE with the wildcards escaped = case-insensitive exact match.
  const { data: player } = await admin
    .from('profiles')
    .select('id, deleted_at')
    .ilike('username', username.replace(/[\\%_]/g, '\\$&'))
    .limit(1)
    .maybeSingle()
  if (!player || player.deleted_at) return { error: `No player found with username "${username}".` }

  const existing = (await invitationRows(admin, tournamentId)).find((r) => r.playerId === player.id)
  if (existing && existing.status !== 'expired') {
    return { error: `This player already has an invitation (${existing.status}).` }
  }

  try {
    const leaderboard = await leaderboardFor(admin, tournament)
    const rankByPlayer = new Map(leaderboard.map((e, i) => [e.playerId, i + 1]))
    if (existing) {
      await reviveExpiredRows(admin, tournament, [player.id], rankByPlayer)
    } else {
      await sendInvitationRows(admin, tournament, [player.id], rankByPlayer, baseInvitationType(tournament))
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not add this player.' }
  }
  revalidatePath(`/admin/tournaments/${tournamentId}/invitations`)
  return { success: true }
}

import type { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
import { lobbyResultSchema } from './lobby-result-schema'

type Admin = ReturnType<typeof createAdminClient>

export type SubmitLobbyResultErrorCode =
  | 'not_in_lobby' | 'lobby_confirmed' | 'validation_failed' | 'result_confirmed' | 'screenshot_required' | 'submit_failed'
export type SubmitLobbyResultResult =
  | { ok: true; tournamentId: string }
  | { ok: false; errorCode: SubmitLobbyResultErrorCode }

interface CallerEntrant {
  entrantId: string
  lobbyStatus: string
  stageId: string
  tournamentId: string
  tournamentTitle: string
}

async function callerEntrantFor(admin: Admin, lobbyId: string, userId: string): Promise<CallerEntrant | null> {
  const { data: raw } = await admin
    .from('lobby_entrants')
    .select(
      'entrant_id, ' +
        'tournament_entrants!inner(player_id, tournament_id, tournaments(title)), ' +
        'tournament_lobbies!inner(status, stage_id)',
    )
    .eq('lobby_id', lobbyId)
    .eq('tournament_entrants.player_id', userId)
    .maybeSingle()
  if (!raw) return null

  const r = raw as unknown as {
    entrant_id: string
    tournament_entrants:
      | { tournament_id: string; tournaments: { title: string } | { title: string }[] | null }
      | { tournament_id: string; tournaments: { title: string } | { title: string }[] | null }[]
    tournament_lobbies: { status: string; stage_id: string } | { status: string; stage_id: string }[]
  }
  const ent = Array.isArray(r.tournament_entrants) ? r.tournament_entrants[0] : r.tournament_entrants
  const lob = Array.isArray(r.tournament_lobbies) ? r.tournament_lobbies[0] : r.tournament_lobbies
  const tRef = Array.isArray(ent?.tournaments) ? ent.tournaments[0] : ent?.tournaments

  return {
    entrantId: r.entrant_id,
    lobbyStatus: lob?.status ?? 'scheduled',
    stageId: lob?.stage_id ?? '',
    tournamentId: ent?.tournament_id ?? '',
    tournamentTitle: tRef?.title ?? 'Tournament',
  }
}

export async function performSubmitLobbyResult(
  admin: Admin,
  userId: string,
  lobbyId: string,
  input: { placement: number; kills: number; screenshotPath: string },
): Promise<SubmitLobbyResultResult> {
  const caller = await callerEntrantFor(admin, lobbyId, userId)
  if (!caller) return { ok: false, errorCode: 'not_in_lobby' }
  if (caller.lobbyStatus === 'confirmed') return { ok: false, errorCode: 'lobby_confirmed' }

  const parsed = lobbyResultSchema.safeParse({ placement: input.placement, kills: input.kills })
  if (!parsed.success) return { ok: false, errorCode: 'validation_failed' }

  const { data: existing } = await admin
    .from('lobby_results')
    .select('id, status, screenshot_url')
    .eq('lobby_id', lobbyId)
    .eq('entrant_id', caller.entrantId)
    .maybeSingle()
  if (existing?.status === 'confirmed') return { ok: false, errorCode: 'result_confirmed' }

  const finalScreenshot = input.screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { ok: false, errorCode: 'screenshot_required' }

  const { count: priorSubmissions } = await admin
    .from('lobby_results')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId)

  const { error } = await admin.from('lobby_results').upsert(
    {
      lobby_id: lobbyId, entrant_id: caller.entrantId, placement: parsed.data.placement, kills: parsed.data.kills,
      placement_points: 0, kill_points: 0, screenshot_url: finalScreenshot, submitted_by: userId, status: 'pending',
    },
    { onConflict: 'lobby_id,entrant_id' },
  )
  if (error) return { ok: false, errorCode: 'submit_failed' }

  if (caller.lobbyStatus === 'scheduled') {
    await admin.from('tournament_lobbies').update({ status: 'awaiting_results' }).eq('id', lobbyId)
  }

  if (!priorSubmissions) {
    const notification = resultNotification({
      type: 'result_needs_review', tournamentTitle: caller.tournamentTitle,
      playerAName: 'Lobby', playerBName: 'results', createdAt: new Date().toISOString(),
    })
    await notifyStaff(admin, 'result_needs_review', {
      title: notification.title,
      body: `${caller.tournamentTitle} — a lobby has results to review.`,
      link: `/admin/tournaments/${caller.tournamentId}/lobbies`,
    })
  }

  return { ok: true, tournamentId: caller.tournamentId }
}

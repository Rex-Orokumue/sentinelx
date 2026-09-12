'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
import { requireStaff } from '@/lib/admin/auth'
import { lobbyResultSchema } from './lobby-result-schema'
import { frozenResultRows, stageIsComplete, type ConfirmRowInput } from './lobby-confirm'
import { validateLobbyResults } from './lobby-validation'
import { parsePointsConfig, DEFAULT_POINTS_CONFIG } from './points-config'

export type LobbyResultState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>

interface StageForConfirm {
  id: string
  tournament_id: string
  rounds_count: number
  points_config: unknown
  tournaments: { games: { slug: string } | { slug: string }[] | null } | { games: { slug: string } | { slug: string }[] | null }[] | null
}

interface CallerEntrant {
  entrantId: string
  lobbyStatus: string
  stageId: string
  tournamentId: string
  tournamentTitle: string
}

// Resolves WHICH entrant the signed-in caller is in this lobby.
//
// This is the authorisation check, and it is deliberately a lookup rather than
// anything read off the form: a player must not be able to submit as someone
// else by editing a hidden input. Returns null when they are not in the lobby.
async function callerEntrantFor(
  admin: Admin,
  lobbyId: string,
  userId: string,
): Promise<CallerEntrant | null> {
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

export async function submitLobbyResult(
  _prev: LobbyResultState,
  formData: FormData,
): Promise<LobbyResultState> {
  const lobbyId = String(formData.get('lobbyId') ?? '')
  const screenshotPath = String(formData.get('screenshotPath') ?? '')
  if (!lobbyId) return { error: 'Missing lobby.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to submit a result.' }

  const admin = createAdminClient()
  const caller = await callerEntrantFor(admin, lobbyId, user.id)
  if (!caller) return { error: 'You are not in this lobby.' }
  if (caller.lobbyStatus === 'confirmed') {
    return { error: 'This lobby has been confirmed and can no longer be edited.' }
  }

  const parsed = lobbyResultSchema.safeParse({
    placement: formData.get('placement'),
    kills: formData.get('kills'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { data: existing } = await admin
    .from('lobby_results')
    .select('id, status, screenshot_url')
    .eq('lobby_id', lobbyId)
    .eq('entrant_id', caller.entrantId)
    .maybeSingle()
  if (existing?.status === 'confirmed') {
    return { error: 'Your result is confirmed and can no longer be edited.' }
  }

  const finalScreenshot = screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { error: 'A screenshot is required.' }

  // Whether this is the lobby's FIRST submission decides if staff get pinged —
  // read before the upsert, or the row we just wrote would count itself.
  const { count: priorSubmissions } = await admin
    .from('lobby_results')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId)

  const { error } = await admin.from('lobby_results').upsert(
    {
      lobby_id: lobbyId,
      entrant_id: caller.entrantId,
      placement: parsed.data.placement,
      kills: parsed.data.kills,
      // Points are written at CONFIRM time, never here. A submission is a
      // claim, and a claim must not be able to move the standings.
      placement_points: 0,
      kill_points: 0,
      screenshot_url: finalScreenshot,
      submitted_by: user.id,
      status: 'pending',
    },
    { onConflict: 'lobby_id,entrant_id' },
  )
  if (error) return { error: 'Could not submit your result. Please try again.' }

  if (caller.lobbyStatus === 'scheduled') {
    await admin.from('tournament_lobbies').update({ status: 'awaiting_results' }).eq('id', lobbyId)
  }

  // Once per lobby, on its first submission. A 48-entrant lobby must not
  // produce 48 alerts — that buries the review queue rather than filling it.
  if (!priorSubmissions) {
    const notification = resultNotification({
      type: 'result_needs_review',
      tournamentTitle: caller.tournamentTitle,
      playerAName: 'Lobby',
      playerBName: 'results',
      createdAt: new Date().toISOString(),
    })
    await notifyStaff(admin, 'result_needs_review', {
      title: notification.title,
      body: `${caller.tournamentTitle} — a lobby has results to review.`,
      link: `/admin/tournaments/${caller.tournamentId}/lobbies`,
    })
  }

  revalidatePath(`/lobbies/${lobbyId}`)
  revalidatePath(`/admin/tournaments/${caller.tournamentId}/lobbies`)
  return { success: true }
}

export async function disputeLobbyResult(
  _prev: LobbyResultState,
  formData: FormData,
): Promise<LobbyResultState> {
  const lobbyId = String(formData.get('lobbyId') ?? '')
  if (!lobbyId) return { error: 'Missing lobby.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const caller = await callerEntrantFor(admin, lobbyId, user.id)
  if (!caller) return { error: 'You are not in this lobby.' }

  // Only their OWN row — a player cannot dispute someone else's result.
  const { error } = await admin
    .from('lobby_results')
    .update({ status: 'disputed' })
    .eq('lobby_id', lobbyId)
    .eq('entrant_id', caller.entrantId)
  if (error) return { error: 'Could not raise the dispute. Please try again.' }

  // The row keeps its frozen points until an admin re-confirms, so raising a
  // dispute cannot silently move the standings.
  const notification = resultNotification({
    type: 'result_disputed',
    tournamentTitle: caller.tournamentTitle,
    playerAName: 'Lobby',
    playerBName: 'result',
    createdAt: new Date().toISOString(),
  })
  await notifyStaff(admin, 'result_disputed', {
    title: notification.title,
    body: `${caller.tournamentTitle} — a player disputed their lobby result.`,
    link: `/admin/tournaments/${caller.tournamentId}/lobbies`,
  })

  revalidatePath(`/lobbies/${lobbyId}`)
  revalidatePath(`/admin/tournaments/${caller.tournamentId}/lobbies`)
  return { success: true }
}

// ── Admin confirmation ──────────────────────────────────────────────────────

export async function confirmLobby(
  _prev: LobbyResultState,
  formData: FormData,
): Promise<LobbyResultState> {
  const staff = await requireStaff()
  const lobbyId = String(formData.get('lobbyId') ?? '')
  if (!lobbyId) return { error: 'Missing lobby.' }

  const admin = createAdminClient()
  const { data: lobbyRaw } = await admin
    .from('tournament_lobbies')
    .select(
      'id, status, stage_id, ' +
        'tournament_stages!inner(id, tournament_id, rounds_count, points_config, ' +
        'tournaments(games(slug)))',
    )
    .eq('id', lobbyId)
    .maybeSingle()
  if (!lobbyRaw) return { error: 'Lobby not found.' }

  const lobby = lobbyRaw as unknown as {
    id: string
    status: string
    stage_id: string
    tournament_stages: StageForConfirm | StageForConfirm[]
  }
  const stage = Array.isArray(lobby.tournament_stages) ? lobby.tournament_stages[0] : lobby.tournament_stages
  if (!stage) return { error: 'Stage not found.' }
  if (lobby.status === 'confirmed') return { error: 'This lobby is already confirmed.' }

  const { data: seats } = await admin
    .from('lobby_entrants')
    .select('entrant_id')
    .eq('lobby_id', lobbyId)
  const entrantIds = (seats ?? []).map((s) => s.entrant_id as string)
  if (entrantIds.length === 0) return { error: 'This lobby has no entrants.' }

  // Read the grid the admin actually submitted. A blank row is refused rather
  // than scored as zero — zero is a real claim (dying first with no kills), so
  // silently writing it would invent a result nobody reported.
  const rows: ConfirmRowInput[] = []
  for (const entrantId of entrantIds) {
    const placementRaw = String(formData.get(`placement_${entrantId}`) ?? '').trim()
    const killsRaw = String(formData.get(`kills_${entrantId}`) ?? '').trim()
    if (placementRaw === '' || killsRaw === '') {
      return {
        error:
          'Every entrant needs a placement and a kill count before this lobby can be confirmed. For someone who never played, record their last placement and 0 kills.',
      }
    }
    const parsed = lobbyResultSchema.safeParse({ placement: placementRaw, kills: killsRaw })
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    rows.push({ entrantId, placement: parsed.data.placement, kills: parsed.data.kills })
  }

  // The same flags the admin saw before pressing confirm are the ones enforced.
  const flags = validateLobbyResults({
    entrantIds,
    rows: rows.map((r) => ({ entrantId: r.entrantId, placement: r.placement, kills: r.kills })),
  })
  const blocking = flags.filter((f) => f.code !== 'missing_submission')
  if (blocking.length > 0) return { error: blocking[0].message }

  const gameRef = Array.isArray(stage.tournaments) ? stage.tournaments[0] : stage.tournaments
  const game = Array.isArray(gameRef?.games) ? gameRef?.games[0] : gameRef?.games
  const config =
    parsePointsConfig(stage.points_config) ?? DEFAULT_POINTS_CONFIG[game?.slug ?? ''] ?? null
  if (!config) return { error: 'This stage has no usable points table. Fix it on the Stages page first.' }

  const verified = { verified_by: staff.userId, verified_at: new Date().toISOString() }
  const { error } = await admin.from('lobby_results').upsert(
    frozenResultRows(config, lobbyId, rows).map((r) => ({ ...r, ...verified })),
    { onConflict: 'lobby_id,entrant_id' },
  )
  if (error) return { error: 'Could not confirm the lobby. Please try again.' }

  await admin.from('tournament_lobbies').update({ status: 'confirmed' }).eq('id', lobbyId)

  // A stage finishes only when every round has been drawn AND every lobby
  // confirmed — see stageIsComplete.
  const { data: allLobbies } = await admin
    .from('tournament_lobbies')
    .select('round_no, status')
    .eq('stage_id', stage.id)
  const lobbyStates = ((allLobbies ?? []) as { round_no: number; status: string }[]).map((l) => ({
    roundNo: l.round_no,
    status: l.status,
  }))
  if (stageIsComplete(stage.rounds_count, lobbyStates)) {
    await admin.from('tournament_stages').update({ status: 'complete' }).eq('id', stage.id)
  }

  revalidatePath(`/admin/tournaments/${stage.tournament_id}/lobbies`)
  revalidatePath(`/admin/tournaments/${stage.tournament_id}/lobbies/${lobbyId}`)
  revalidatePath(`/admin/tournaments/${stage.tournament_id}/stages`)
  revalidatePath(`/lobbies/${lobbyId}`)
  return { success: true }
}

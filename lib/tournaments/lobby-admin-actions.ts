'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { assignLobbies } from './lobby-assignment'
import { seedOrderForRound, stageIntake } from './stage-entry'
import { stageStanding } from './stage-standing'

export type LobbyState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>

interface StageRow {
  id: string
  tournament_id: string
  seq: number
  name: string
  rounds_count: number
  lobby_size: number
  advance_count: number
  status: string
}

async function loadStage(admin: Admin, stageId: string): Promise<StageRow | null> {
  const { data } = await admin
    .from('tournament_stages')
    .select('id, tournament_id, seq, name, rounds_count, lobby_size, advance_count, status')
    .eq('id', stageId)
    .maybeSingle()
  return (data as StageRow | null) ?? null
}

async function activeEntrantIds(admin: Admin, tournamentId: string): Promise<string[]> {
  const { data } = await admin
    .from('tournament_entrants')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'active')
    .order('created_at')
  return (data ?? []).map((r) => r.id as string)
}

// Shared by openStage (round 1) and generateNextRound (round N+1): draw the
// given order into lobbies and write both the lobbies and their entrant lists.
async function createRoundLobbies(
  admin: Admin,
  stage: StageRow,
  roundNo: number,
  orderedEntrantIds: string[],
): Promise<void> {
  const lobbies = assignLobbies(orderedEntrantIds, stage.lobby_size)

  for (const lobby of lobbies) {
    const { data: created, error } = await admin
      .from('tournament_lobbies')
      .insert({ stage_id: stage.id, round_no: roundNo, label: lobby.label })
      .select('id')
      .single()
    if (error || !created) throw new Error(`Failed to create lobby ${lobby.label}: ${error?.message ?? 'unknown'}`)

    const { error: entErr } = await admin
      .from('lobby_entrants')
      .insert(lobby.entrantIds.map((entrantId) => ({ lobby_id: created.id, entrant_id: entrantId })))
    if (entErr) throw new Error(`Failed to seat lobby ${lobby.label}: ${entErr.message}`)
  }
}

function revalidateStage(tournamentId: string): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/stages`)
  revalidatePath(`/admin/tournaments/${tournamentId}/lobbies`)
}

export async function openStage(_prev: LobbyState, formData: FormData): Promise<LobbyState> {
  await requireStaff()
  const stageId = String(formData.get('stageId') ?? '')
  if (!stageId) return { error: 'Missing stage.' }

  const admin = createAdminClient()
  const stage = await loadStage(admin, stageId)
  if (!stage) return { error: 'Stage not found.' }
  if (stage.status !== 'pending') return { error: 'This stage has already been opened.' }

  const { data: tournament } = await admin
    .from('tournaments')
    .select('competition_format')
    .eq('id', stage.tournament_id)
    .maybeSingle()
  if (tournament?.competition_format !== 'points_race') {
    return { error: 'Stages apply only to points-race tournaments.' }
  }

  // Stage 1 takes the whole field; a later stage takes the previous stage's
  // top N, which requires that stage to have finished.
  let intake: string[]
  if (stage.seq === 1) {
    intake = stageIntake(null, await activeEntrantIds(admin, stage.tournament_id), null)
  } else {
    const { data: prevRow } = await admin
      .from('tournament_stages')
      .select('id, tournament_id, seq, name, rounds_count, lobby_size, advance_count, status')
      .eq('tournament_id', stage.tournament_id)
      .eq('seq', stage.seq - 1)
      .maybeSingle()
    const prev = (prevRow as StageRow | null) ?? null
    if (!prev) return { error: 'The previous stage is missing.' }
    if (prev.status !== 'complete') {
      return { error: `${prev.name} has not finished yet, so its qualifiers are not decided.` }
    }
    intake = stageIntake(await stageStanding(admin, prev), [], prev.advance_count)
  }

  if (intake.length < 2) return { error: 'A stage needs at least 2 entrants.' }

  try {
    await createRoundLobbies(admin, stage, 1, seedOrderForRound(1, intake, []))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to create lobbies.' }
  }
  await admin.from('tournament_stages').update({ status: 'live' }).eq('id', stage.id)

  revalidateStage(stage.tournament_id)
  return { success: true }
}

export async function generateNextRound(_prev: LobbyState, formData: FormData): Promise<LobbyState> {
  await requireStaff()
  const stageId = String(formData.get('stageId') ?? '')
  if (!stageId) return { error: 'Missing stage.' }

  const admin = createAdminClient()
  const stage = await loadStage(admin, stageId)
  if (!stage) return { error: 'Stage not found.' }
  if (stage.status !== 'live') return { error: 'This stage is not running.' }

  const { data: existing } = await admin
    .from('tournament_lobbies')
    .select('id, round_no, status')
    .eq('stage_id', stage.id)
  const lobbies = (existing ?? []) as { id: string; round_no: number; status: string }[]
  if (lobbies.length === 0) return { error: 'This stage has no lobbies yet — open it first.' }

  const currentRound = Math.max(...lobbies.map((l) => l.round_no))
  if (currentRound >= stage.rounds_count) {
    return { error: `${stage.name} has already played all ${stage.rounds_count} of its rounds.` }
  }

  // Re-seeding on half-scored standings would produce a draw that changes as
  // the remaining results land — the admin would watch lobbies reshuffle under
  // them. Do not relax this for convenience.
  const unconfirmed = lobbies.filter((l) => l.round_no === currentRound && l.status !== 'confirmed')
  if (unconfirmed.length > 0) {
    return {
      error: `Round ${currentRound} still has ${unconfirmed.length} lobby/lobbies awaiting confirmation. Confirm them before drawing the next round.`,
    }
  }

  // A stage's field does not shrink between its own rounds — everyone who
  // started the stage plays every round of it. Only the ORDER changes.
  const roundOneLobbyIds = lobbies.filter((l) => l.round_no === 1).map((l) => l.id)
  const { data: seatRows } = await admin
    .from('lobby_entrants')
    .select('entrant_id')
    .in('lobby_id', roundOneLobbyIds)
  const intake = Array.from(new Set((seatRows ?? []).map((r) => r.entrant_id as string)))
  if (intake.length < 2) return { error: 'A stage needs at least 2 entrants.' }

  const nextRound = currentRound + 1
  try {
    const standing = await stageStanding(admin, stage)
    await createRoundLobbies(admin, stage, nextRound, seedOrderForRound(nextRound, intake, standing))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to create lobbies.' }
  }

  revalidateStage(stage.tournament_id)
  return { success: true }
}

export async function updateLobbyDetails(_prev: LobbyState, formData: FormData): Promise<LobbyState> {
  await requireStaff()
  const lobbyId = String(formData.get('lobbyId') ?? '')
  if (!lobbyId) return { error: 'Missing lobby.' }

  const admin = createAdminClient()
  const { data: lobby } = await admin
    .from('tournament_lobbies')
    .select('id, status, stage_id')
    .eq('id', lobbyId)
    .maybeSingle()
  if (!lobby) return { error: 'Lobby not found.' }
  if (lobby.status === 'confirmed') return { error: 'This lobby is confirmed and can no longer be edited.' }

  const scheduledAt = String(formData.get('scheduledAt') ?? '').trim()
  const { error } = await admin
    .from('tournament_lobbies')
    .update({
      room_id: String(formData.get('roomId') ?? '').trim() || null,
      room_password: String(formData.get('roomPassword') ?? '').trim() || null,
      // <input type="datetime-local"> yields local time with no offset; stored
      // as-is, matching how match scheduling already handles it.
      scheduled_at: scheduledAt === '' ? null : scheduledAt,
      youtube_stream_url: String(formData.get('youtubeStreamUrl') ?? '').trim() || null,
    })
    .eq('id', lobbyId)
  if (error) return { error: 'Could not save the lobby details.' }

  const { data: stage } = await admin
    .from('tournament_stages')
    .select('tournament_id')
    .eq('id', lobby.stage_id)
    .maybeSingle()
  if (stage) revalidateStage(stage.tournament_id)
  return { success: true }
}

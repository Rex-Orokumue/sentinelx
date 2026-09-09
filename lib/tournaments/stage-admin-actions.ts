'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { stageSchema } from './stage-schema'

export type StageFormState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>

// lobby_results freeze their own points at confirm time, so rounds already
// played are safe from a points-table edit either way. But a stage's shape —
// rounds, lobby size, advance count — still governs a stage that is running or
// finished, so a completed one is locked.
async function assertStageEditable(
  admin: Admin,
  stageId: string,
): Promise<{ tournamentId: string } | { error: string }> {
  const { data: stage } = await admin
    .from('tournament_stages')
    .select('tournament_id, status')
    .eq('id', stageId)
    .maybeSingle()
  if (!stage) return { error: 'Stage not found.' }
  if (stage.status === 'complete') return { error: 'This stage has finished and can no longer be edited.' }
  return { tournamentId: stage.tournament_id }
}

export async function createStage(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = stageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  // Next free position. Deliberately not a row count — a deleted middle stage
  // would make the count collide with an existing seq.
  const { data: last } = await admin
    .from('tournament_stages')
    .select('seq')
    .eq('tournament_id', tournamentId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await admin.from('tournament_stages').insert({
    tournament_id: tournamentId,
    seq: (last?.seq ?? 0) + 1,
    name: parsed.data.name,
    rounds_count: parsed.data.roundsCount,
    lobby_size: parsed.data.lobbySize,
    advance_count: parsed.data.advanceCount,
    points_config: { placement: parsed.data.placementPoints, per_kill: parsed.data.perKill },
    status: 'pending',
  })
  if (error) return { error: 'Could not add the stage. Please try again.' }

  revalidatePath(`/admin/tournaments/${tournamentId}/stages`)
  return { success: true }
}

export async function updateStage(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  await requireStaff()
  const stageId = String(formData.get('stageId') ?? '')
  if (!stageId) return { error: 'Missing stage.' }

  const parsed = stageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  const guard = await assertStageEditable(admin, stageId)
  if ('error' in guard) return { error: guard.error }

  const { error } = await admin
    .from('tournament_stages')
    .update({
      name: parsed.data.name,
      rounds_count: parsed.data.roundsCount,
      lobby_size: parsed.data.lobbySize,
      advance_count: parsed.data.advanceCount,
      points_config: { placement: parsed.data.placementPoints, per_kill: parsed.data.perKill },
    })
    .eq('id', stageId)
  if (error) return { error: 'Could not save the stage. Please try again.' }

  revalidatePath(`/admin/tournaments/${guard.tournamentId}/stages`)
  return { success: true }
}

export async function deleteStage(_prev: StageFormState, formData: FormData): Promise<StageFormState> {
  await requireStaff()
  const stageId = String(formData.get('stageId') ?? '')
  if (!stageId) return { error: 'Missing stage.' }

  const admin = createAdminClient()
  const guard = await assertStageEditable(admin, stageId)
  if ('error' in guard) return { error: guard.error }

  // Lobbies and their results cascade from the stage (migration
  // 20260909092000), so deleting a stage that has been played would silently
  // take real results with it. Only a stage with no lobbies can go.
  const { count: lobbies } = await admin
    .from('tournament_lobbies')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stageId)
  if ((lobbies ?? 0) > 0) {
    return { error: 'This stage already has lobbies. Remove them before deleting the stage.' }
  }

  const { error } = await admin.from('tournament_stages').delete().eq('id', stageId)
  if (error) return { error: 'Could not delete the stage.' }

  revalidatePath(`/admin/tournaments/${guard.tournamentId}/stages`)
  return { success: true }
}

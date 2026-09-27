'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { squadNameSchema, inviteCodeSchema } from './squad-schema'
import { maybeCompleteSquad } from './squad-membership'
import { performCreateSquad, type CreateSquadErrorCode } from './create-squad-service'
import { performLookupSquad, type LookupSquadErrorCode } from './lookup-squad-service'

export type CreateSquadState = { error?: string; squadId?: string; inviteCode?: string } | undefined

const CREATE_SQUAD_MESSAGE: Record<CreateSquadErrorCode, string> = {
  no_username: 'Claim a username before creating a squad.',
  tournament_not_found: 'Tournament not found.',
  not_squad_tournament: 'This tournament does not use squads.',
  registration_closed: 'Registration is not open.',
  already_in_squad: "You're already in a squad for this tournament.",
  invite_code_failed: 'Could not create a squad. Please try again.',
  name_taken: 'A squad with that name already exists in this tournament.',
  create_failed: 'Could not create the squad. Please try again.',
}

// Self-serve squad creation (spec §5.1). Only creates the squad row — the
// captain still registers (and pays) through the ordinary
// registerForTournament flow with this squad's id, exactly like every other
// member.
export async function createSquad(_prev: CreateSquadState, formData: FormData): Promise<CreateSquadState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const parsedName = squadNameSchema.safeParse(formData.get('name') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  if (!parsedName.success) return { error: parsedName.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to create a squad.' }

  const result = await performCreateSquad(supabase, createAdminClient(), user.id, { tournamentId, name: parsedName.data })
  if (!result.ok) return { error: CREATE_SQUAD_MESSAGE[result.errorCode] }

  revalidatePath(`/tournaments`)
  return { squadId: result.squadId, inviteCode: result.inviteCode }
}

export type SquadLookupState =
  | { error?: string; squad?: { id: string; name: string; memberCount: number; teamSize: number } }
  | undefined

const LOOKUP_SQUAD_MESSAGE: Record<LookupSquadErrorCode, string> = {
  tournament_not_found: 'Tournament not found.',
  squad_not_found: 'No squad found for that code.',
  not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
}

// Read-only preview before the player commits to registering — the UI shows
// "You're joining: <name> (n/size)" before the payment step.
export async function lookupSquadByCode(_prev: SquadLookupState, formData: FormData): Promise<SquadLookupState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const parsedCode = inviteCodeSchema.safeParse(formData.get('code') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }
  if (!parsedCode.success) return { error: 'Enter a valid invite code.' }

  const result = await performLookupSquad(createClient(), { tournamentId, code: parsedCode.data })
  if (!result.ok) return { error: LOOKUP_SQUAD_MESSAGE[result.errorCode] }

  return { squad: result.squad }
}

export type SquadMoveState = { error?: string; success?: boolean } | undefined

// Pulls a player out to the unassigned pool. The squad they left can no
// longer be 'complete' (it's below team_size) — dropped back to 'forming' so
// the "every listed squad is exactly team_size" invariant stays honest until
// an admin backfills it via moveSquadMember. Admin-only (roster editing is
// staff territory, same as movePlayerToGroup for BR groups), and only while
// the tournament is registration_closed — squads are locked in once the
// tournament goes live, same pre-publish window movePlayerToGroup already
// uses for head-to-head groups.
export async function removeSquadMember(_prev: SquadMoveState, formData: FormData): Promise<SquadMoveState> {
  await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  if (!tournamentId || !playerId) return { error: 'Missing player.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status').eq('id', tournamentId).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed') return { error: 'Squads can only be edited before the tournament goes live.' }

  const { data: membership } = await admin
    .from('squad_members')
    .select('id, squad_id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (!membership) return { error: 'Player is not in a squad for this tournament.' }

  const { error: delErr } = await admin.from('squad_members').delete().eq('id', membership.id)
  if (delErr) return { error: `Failed to remove player: ${delErr.message}` }

  await admin.from('squads').update({ status: 'forming' }).eq('id', membership.squad_id).eq('status', 'complete')

  revalidatePath(`/admin/tournaments/${tournamentId}/squads`)
  return { success: true }
}

// Places an unassigned player (or one just pulled out by removeSquadMember)
// into a squad that currently has room. Refuses to push a squad past
// team_size — a team squad has no size range to grow into (spec §5.2).
export async function moveSquadMember(_prev: SquadMoveState, formData: FormData): Promise<SquadMoveState> {
  await requireAdmin()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const toSquadId = String(formData.get('toSquadId') ?? '')
  if (!tournamentId || !playerId || !toSquadId) return { error: 'Missing move details.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status, squad_size').eq('id', tournamentId).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed') return { error: 'Squads can only be edited before the tournament goes live.' }
  const teamSize = t.squad_size ?? 0

  const { data: toSquad } = await admin.from('squads').select('id, tournament_id').eq('id', toSquadId).maybeSingle()
  if (!toSquad || toSquad.tournament_id !== tournamentId) return { error: 'Target squad is not part of this tournament.' }

  const { data: existingMembership } = await admin
    .from('squad_members')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (existingMembership) return { error: 'Player is already in a squad — remove them first.' }

  const { data: paidReg } = await admin
    .from('tournament_registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .eq('payment_status', 'paid')
    .maybeSingle()
  if (!paidReg) return { error: 'Player has no paid registration for this tournament.' }

  const { count: toCount } = await admin.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', toSquadId)
  if ((toCount ?? 0) >= teamSize) return { error: 'That squad is already full.' }

  const { error: insErr } = await admin.from('squad_members').insert({
    squad_id: toSquadId,
    tournament_id: tournamentId,
    player_id: playerId,
    role: 'member',
    registration_id: paidReg.id,
  })
  if (insErr) return { error: `Failed to move player: ${insErr.message}` }

  await maybeCompleteSquad(admin, toSquadId, teamSize)

  revalidatePath(`/admin/tournaments/${tournamentId}/squads`)
  return { success: true }
}

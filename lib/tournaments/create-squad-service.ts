import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { uniqueInviteCode } from './squad-membership'

type Admin = ReturnType<typeof createAdminClient>

export type CreateSquadErrorCode =
  | 'no_username' | 'tournament_not_found' | 'not_squad_tournament' | 'registration_closed'
  | 'already_in_squad' | 'invite_code_failed' | 'name_taken' | 'create_failed'
export type CreateSquadResult =
  | { ok: true; squadId: string; inviteCode: string }
  | { ok: false; errorCode: CreateSquadErrorCode }

export async function performCreateSquad(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  input: { tournamentId: string; name: string },
): Promise<CreateSquadResult> {
  const { data: profile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!profile?.username) return { ok: false, errorCode: 'no_username' }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, entry_unit')
    .eq('id', input.tournamentId)
    .maybeSingle()
  if (!tournament) return { ok: false, errorCode: 'tournament_not_found' }
  if (tournament.entry_unit !== 'squad') return { ok: false, errorCode: 'not_squad_tournament' }
  if (tournament.status !== 'registration_open') return { ok: false, errorCode: 'registration_closed' }

  const { data: existingMembership } = await supabase
    .from('squad_members')
    .select('id')
    .eq('tournament_id', input.tournamentId)
    .eq('player_id', userId)
    .maybeSingle()
  if (existingMembership) return { ok: false, errorCode: 'already_in_squad' }

  let inviteCode: string
  try {
    inviteCode = await uniqueInviteCode(admin)
  } catch {
    return { ok: false, errorCode: 'invite_code_failed' }
  }

  const { data: squad, error } = await admin
    .from('squads')
    .insert({ tournament_id: input.tournamentId, name: input.name, captain_id: userId, invite_code: inviteCode, status: 'forming' })
    .select('id, invite_code')
    .single()
  if (error || !squad) {
    return { ok: false, errorCode: (error as { code?: string } | null)?.code === '23505' ? 'name_taken' : 'create_failed' }
  }

  return { ok: true, squadId: squad.id, inviteCode: squad.invite_code }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export type LookupSquadErrorCode = 'tournament_not_found' | 'squad_not_found' | 'not_accepting_members' | 'squad_full'
export type LookupSquadResult =
  | { ok: true; squad: { id: string; name: string; memberCount: number; teamSize: number } }
  | { ok: false; errorCode: LookupSquadErrorCode }

export async function performLookupSquad(
  supabase: SupabaseClient<Database>,
  input: { tournamentId: string; code: string },
): Promise<LookupSquadResult> {
  const { data: tournament } = await supabase.from('tournaments').select('squad_size').eq('id', input.tournamentId).maybeSingle()
  if (!tournament?.squad_size) return { ok: false, errorCode: 'tournament_not_found' }

  const { data: squad } = await supabase
    .from('squads')
    .select('id, name, tournament_id, status')
    .eq('invite_code', input.code)
    .maybeSingle()
  if (!squad || squad.tournament_id !== input.tournamentId) return { ok: false, errorCode: 'squad_not_found' }
  if (squad.status !== 'forming') return { ok: false, errorCode: 'not_accepting_members' }

  const { count } = await supabase.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', squad.id)
  if ((count ?? 0) >= tournament.squad_size) return { ok: false, errorCode: 'squad_full' }

  return { ok: true, squad: { id: squad.id, name: squad.name, memberCount: count ?? 0, teamSize: tournament.squad_size } }
}

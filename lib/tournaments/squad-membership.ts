import type { createAdminClient } from '@/lib/supabase/admin'
import { generateInviteCode } from './squad-lifecycle'

type Admin = ReturnType<typeof createAdminClient>

export async function uniqueInviteCode(admin: Admin): Promise<string> {
  // Not a hard transactional guarantee — same tolerance for a vanishingly
  // unlikely race this codebase already accepts elsewhere (e.g.
  // seededPaidPlayers' non-locked capacity check). 32^8 possible codes makes
  // an actual collision astronomically unlikely; this loop exists for
  // correctness, not because a collision is expected.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    const { data } = await admin.from('squads').select('id').eq('invite_code', code).maybeSingle()
    if (!data) return code
  }
  throw new Error('Could not generate a unique invite code — please try again.')
}

// A squad that just reached its team_size flips forming -> complete. Called
// after any insert into squad_members that could have been the one that
// filled it. Conditional UPDATE (status='forming' in the WHERE) so a second
// caller racing to complete the same squad is a harmless no-op.
export async function maybeCompleteSquad(admin: Admin, squadId: string, teamSize: number): Promise<void> {
  const { count } = await admin
    .from('squad_members')
    .select('*', { count: 'exact', head: true })
    .eq('squad_id', squadId)
  if ((count ?? 0) < teamSize) return
  await admin.from('squads').update({ status: 'complete' }).eq('id', squadId).eq('status', 'forming')
}

// The self-serve join flow's completion step: registerForTournament records
// intent (tournament_registrations.joining_squad_id) *before* payment
// resolves; this turns that intent into an actual squad_members row once
// payment_status has genuinely become 'paid' — called from every place that
// happens (registerForTournament's three synchronous paths, and
// confirmRegistration's async webhook/callback path), so it must be
// idempotent against being called more than once for the same registration.
export async function finalizeSquadJoin(admin: Admin, registrationId: string): Promise<void> {
  const { data: reg } = await admin
    .from('tournament_registrations')
    .select('id, tournament_id, player_id, payment_status, joining_squad_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (!reg || !reg.joining_squad_id || reg.payment_status !== 'paid') return

  const { data: already } = await admin
    .from('squad_members')
    .select('id')
    .eq('registration_id', reg.id)
    .maybeSingle()
  if (already) return // already finalized — idempotent

  const { data: squad } = await admin
    .from('squads')
    .select('id, tournament_id, captain_id, status')
    .eq('id', reg.joining_squad_id)
    .maybeSingle()
  if (!squad || squad.tournament_id !== reg.tournament_id || squad.status !== 'forming') return

  const { data: tournament } = await admin
    .from('tournaments')
    .select('squad_size')
    .eq('id', reg.tournament_id)
    .maybeSingle()
  const teamSize = tournament?.squad_size ?? 0
  if (teamSize <= 0) return

  const { count: currentCount } = await admin
    .from('squad_members')
    .select('*', { count: 'exact', head: true })
    .eq('squad_id', squad.id)
  if ((currentCount ?? 0) >= teamSize) return // filled while this player's payment was in flight

  const { error: insErr } = await admin.from('squad_members').insert({
    squad_id: squad.id,
    tournament_id: reg.tournament_id,
    player_id: reg.player_id,
    role: reg.player_id === squad.captain_id ? 'captain' : 'member',
    registration_id: reg.id,
  })
  // squad_members_one_squad_per_tournament (player already in another squad
  // for this tournament) — silently no-op, the same light-race tolerance as
  // the count check above.
  if (insErr) return

  await maybeCompleteSquad(admin, squad.id, teamSize)
}

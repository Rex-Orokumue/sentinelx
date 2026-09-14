import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Active, paid players ordered by sx_score desc, ties broken randomly. This is
// the eligible pool for bracket generation (closeRegistration/generateBracket)
// and for the bracket_released notification fan-out (publishBracket) — must
// stay in sync with the registrations page's own "N paid" count, which
// filters the same two columns (RegistrationsPage: paymentStatus === 'paid'
// && status === 'active'). A disqualified or removed registration keeps
// payment_status untouched by design (see disqualifyRegistration/
// removeRegistration), so payment_status alone is not enough to identify who
// belongs in the bracket.
export async function seededPaidPlayers(admin: Admin, tournamentId: string): Promise<string[]> {
  const { data: regs } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')
    .eq('status', 'active')
  const ids = (regs ?? []).map((r) => r.player_id)
  if (ids.length === 0) return []
  const { data: profs } = await admin.from('profiles').select('id, sx_score').in('id', ids)
  const scoreById = new Map((profs ?? []).map((p) => [p.id, p.sx_score]))
  return ids
    .map((id) => ({ id, score: scoreById.get(id) ?? 0, r: Math.random() }))
    .sort((a, b) => b.score - a.score || a.r - b.r)
    .map((x) => x.id)
}

// Complete squads, ordered by average roster sx_score desc, ties broken
// randomly — the squad analogue of seededPaidPlayers above, for a
// head_to_head tournament whose entry_unit is 'squad' (team-vs-team). A
// squad only reaches 'complete' once every self-serve join has paid or an
// admin-arranged group was formed from already-paid registrants
// (lib/tournaments/squad-membership.ts, lib/tournaments/
// bracket-admin-actions.ts), so there is no separate "paid" filter to apply
// here the way seededPaidPlayers needs one.
export async function seededPaidSquads(admin: Admin, tournamentId: string): Promise<string[]> {
  const { data: squads } = await admin
    .from('squads')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'complete')
  const squadIds = (squads ?? []).map((s) => s.id as string)
  if (squadIds.length === 0) return []

  const { data: members } = await admin.from('squad_members').select('squad_id, player_id').in('squad_id', squadIds)
  const rows = members ?? []
  const playerIds = Array.from(new Set(rows.map((m) => m.player_id as string)))
  const { data: profs } =
    playerIds.length > 0 ? await admin.from('profiles').select('id, sx_score').in('id', playerIds) : { data: [] }
  const scoreById = new Map((profs ?? []).map((p) => [p.id, p.sx_score]))

  const rosterBySquad = new Map<string, string[]>()
  for (const m of rows) {
    const squadId = m.squad_id as string
    const list = rosterBySquad.get(squadId)
    if (list) list.push(m.player_id as string)
    else rosterBySquad.set(squadId, [m.player_id as string])
  }

  return squadIds
    .map((id) => {
      const roster = rosterBySquad.get(id) ?? []
      const avg =
        roster.length > 0 ? roster.reduce((sum, pid) => sum + (scoreById.get(pid) ?? 0), 0) / roster.length : 0
      return { id, score: avg, r: Math.random() }
    })
    .sort((a, b) => b.score - a.score || a.r - b.r)
    .map((x) => x.id)
}

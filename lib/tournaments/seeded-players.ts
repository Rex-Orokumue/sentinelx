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

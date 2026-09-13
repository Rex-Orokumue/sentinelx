import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SquadAssemblyReview } from '@/components/admin/SquadAssemblyReview'

export default async function AdminSquadsPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const admin = createAdminClient()

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, title, status, entry_unit, squad_size')
    .eq('id', params.id)
    .maybeSingle()
  if (!tournament || tournament.entry_unit !== 'squad') notFound()

  const { data: squads } = await admin
    .from('squads')
    .select('id, name, status, captain_id')
    .eq('tournament_id', tournament.id)
    .order('name')

  const { data: members } = await admin
    .from('squad_members')
    .select('squad_id, player_id, role, profiles(username, display_name)')
    .eq('tournament_id', tournament.id)

  const { data: paidRegs } = await admin
    .from('tournament_registrations')
    .select('player_id, profiles(username, display_name)')
    .eq('tournament_id', tournament.id)
    .eq('payment_status', 'paid')
    .eq('status', 'active')

  const placedIds = new Set((members ?? []).map((m) => m.player_id))
  const unassigned = (paidRegs ?? [])
    .filter((r) => !placedIds.has(r.player_id))
    .map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      return { playerId: r.player_id as string, name: p?.display_name ?? p?.username ?? 'Player' }
    })

  const squadRows = (squads ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    members: (members ?? [])
      .filter((m) => m.squad_id === s.id)
      .map((m) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return { playerId: m.player_id as string, role: m.role as string, name: p?.display_name ?? p?.username ?? 'Player' }
      }),
  }))

  return (
    <SquadAssemblyReview
      tournamentId={tournament.id}
      tournamentTitle={tournament.title}
      teamSize={tournament.squad_size ?? 0}
      squads={squadRows}
      unassigned={unassigned}
    />
  )
}

import Link from 'next/link'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InvitationsPanel } from '@/components/admin/InvitationsPanel'

export default async function TournamentInvitationsPage({ params }: { params: { id: string } }) {
  const ctx = await requireStaff()
  const admin = createAdminClient()
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, title, tournament_type, status, registration_fee')
    .eq('id', params.id)
    .maybeSingle()

  if (!tournament || (tournament.tournament_type !== 'masters' && tournament.tournament_type !== 'champions_cup')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-slate-400">Invitations only apply to Masters and Champions Cup tournaments.</p>
      </div>
    )
  }

  const [{ data: invitations }, { data: registrations }] = await Promise.all([admin
    .from('tournament_invitations')
    .select('id, player_id, rank_at_invite, status, invited_at, expires_at, player:profiles(username, display_name)')
    .eq('tournament_id', params.id)
    .order('rank_at_invite'),
    admin.from('tournament_registrations').select('player_id, payment_status, payment_source, status')
      .eq('tournament_id', params.id),
  ])

  const registrationByPlayer = new Map((registrations ?? []).map((registration) => [registration.player_id, registration]))
  const rows = (invitations ?? []).map((row) => {
    const p = Array.isArray(row.player) ? row.player[0] : row.player
    const registration = registrationByPlayer.get(row.player_id)
    return {
      id: row.id,
      playerId: row.player_id,
      username: p?.username ?? 'Unknown',
      playerName: p?.display_name ?? p?.username ?? 'Unknown',
      rank: row.rank_at_invite,
      status: row.status,
      invitedAt: row.invited_at,
      expiresAt: row.expires_at,
      paymentStatus: registration?.payment_status ?? null,
      paymentSource: registration?.payment_source ?? null,
      registrationStatus: registration?.status ?? null,
    }
  })

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/tournaments" className="text-sm text-slate-400 hover:text-white">
        ← Tournaments
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold text-white">{tournament.title} — Invitations</h1>
      <InvitationsPanel tournamentId={tournament.id} tournamentStatus={tournament.status}
        registrationFee={tournament.registration_fee} isAdmin={ctx.isAdmin} invitations={rows} />
    </div>
  )
}

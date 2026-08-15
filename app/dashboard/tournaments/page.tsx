import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'My Tournaments · SentinelX Esports', robots: { index: false, follow: false } }

type TournamentRef = { title: string; slug: string; status: string } | { title: string; slug: string; status: string }[] | null
function firstTournament(t: TournamentRef) {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function DashboardTournamentsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/tournaments')

  const { data: regsRes } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status, registered_at, tournament:tournaments(title, slug, status)')
    .eq('player_id', user.id)
    .order('registered_at', { ascending: false })

  const registrations: RegistrationRow[] = ((regsRes as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return {
      id: r.id,
      paymentStatus: r.payment_status,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
    }
  })

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">My Tournaments</h1>
      <MyTournaments registrations={registrations} />
    </DashboardShell>
  )
}

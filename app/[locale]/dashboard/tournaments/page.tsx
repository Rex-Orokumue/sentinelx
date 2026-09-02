import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MyTournaments, type RegistrationRow } from '@/components/dashboard/MyTournaments'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { resolveGameIconUrl } from '@/lib/games/icon'

export const metadata: Metadata = { title: 'My Tournaments · SentinelX Esports', robots: { index: false, follow: false } }

type GameRef = { name: string; icon_url: string | null; slug: string | null; category: string | null }
type TournamentShape = { title: string; slug: string; status: string; games: GameRef | GameRef[] | null }
type TournamentRef = TournamentShape | TournamentShape[] | null
function firstTournament(t: TournamentRef): TournamentShape | null {
  return Array.isArray(t) ? t[0] ?? null : t
}
function firstGame(g: GameRef | GameRef[] | null | undefined): GameRef | null {
  return Array.isArray(g) ? g[0] ?? null : g ?? null
}

export default async function DashboardTournamentsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/tournaments')

  const { data: regsRes } = await supabase
    .from('tournament_registrations')
    .select(
      'id, payment_status, registered_at, tournament:tournaments(title, slug, status, games(name, icon_url, slug, category))',
    )
    .eq('player_id', user.id)
    .order('registered_at', { ascending: false })

  const registrations: RegistrationRow[] = ((regsRes as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    const g = firstGame(t?.games)
    return {
      id: r.id,
      paymentStatus: r.payment_status,
      tournamentTitle: t?.title ?? 'Tournament',
      tournamentSlug: t?.slug ?? '',
      gameName: g?.name ?? null,
      gameIconUrl: resolveGameIconUrl(g),
      gameCategory: g?.category ?? null,
    }
  })

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">My Tournaments</h1>
      <MyTournaments registrations={registrations} />
    </DashboardShell>
  )
}

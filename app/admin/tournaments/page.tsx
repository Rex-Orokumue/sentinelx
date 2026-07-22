import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { missingForPublish } from '@/lib/tournaments/readiness'
import { TournamentListRow, type AdminTournamentRow } from '@/components/admin/TournamentListRow'

export const metadata: Metadata = { title: 'Tournaments · Admin · SentinelX' }

type GameRef = { name: string } | { name: string }[] | null
function gameName(g: GameRef): string | null {
  if (Array.isArray(g)) return g[0]?.name ?? null
  return g?.name ?? null
}

export default async function AdminTournamentsPage() {
  const ctx = await requireStaff()
  const supabase = createClient()
  const [{ data }, { data: paidRegs }] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, status, game_id, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end, games(name)',
      )
      .order('created_at', { ascending: false }),
    supabase.from('tournament_registrations').select('tournament_id').eq('payment_status', 'paid'),
  ])

  const paidCountByTournament = new Map<string, number>()
  for (const r of (paidRegs as { tournament_id: string }[] | null) ?? []) {
    paidCountByTournament.set(r.tournament_id, (paidCountByTournament.get(r.tournament_id) ?? 0) + 1)
  }

  const rows: AdminTournamentRow[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const t = raw as {
      id: string
      title: string
      slug: string
      status: string
      game_id: string | null
      max_players: number | null
      registration_fee: number | null
      prize_pool: number | null
      registration_start: string | null
      registration_end: string | null
      tournament_start: string | null
      tournament_end: string | null
      games: GameRef
    }
    return {
      id: t.id,
      title: t.title,
      slug: t.slug,
      status: t.status,
      gameName: gameName(t.games),
      publishBlockers: missingForPublish({
        gameId: t.game_id,
        maxPlayers: t.max_players,
        registrationFee: t.registration_fee,
        prizePool: t.prize_pool,
        dates: [
          t.registration_start,
          t.registration_end,
          t.tournament_start,
          t.tournament_end,
        ],
      }),
      paidRegistrations: paidCountByTournament.get(t.id) ?? 0,
    }
  })

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">All tournaments</h2>
        <Link
          href="/admin/tournaments/new"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"
        >
          + New tournament
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No tournaments yet. Create the first one.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <TournamentListRow key={t.id} t={t} isAdmin={ctx.isAdmin} />
          ))}
        </div>
      )}
    </section>
  )
}

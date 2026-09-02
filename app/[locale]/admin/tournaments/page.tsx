import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { missingForPublish } from '@/lib/tournaments/readiness'
import { TournamentListRow, type AdminTournamentRow } from '@/components/admin/TournamentListRow'
import { AdminTournamentGameFilter } from '@/components/admin/AdminTournamentGameFilter'
import { resolveTournamentImageUrl } from '@/lib/games/icon'
import {
  ADMIN_TOURNAMENT_STATUS_FILTERS,
  filterStatusValues,
  isAdminTournamentStatusFilter,
  type AdminTournamentStatusFilter,
} from '@/lib/tournaments/admin-filter'

export const metadata: Metadata = { title: 'Tournaments · Admin · SentinelX' }

type GameRef =
  | { name: string; icon_url: string | null; slug: string | null; category: string | null }
  | { name: string; icon_url: string | null; slug: string | null; category: string | null }[]
  | null
function firstGame(g: GameRef) {
  return Array.isArray(g) ? g[0] ?? null : g
}

type SearchParams = { game?: string; status?: string }

export default async function AdminTournamentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireStaff()
  const supabase = createClient()

  const statusFilter: AdminTournamentStatusFilter = isAdminTournamentStatusFilter(searchParams.status)
    ? searchParams.status
    : 'all'

  const { data: gamesList } = await supabase.from('games').select('id, name, slug').order('name')
  const allGames = ((gamesList as { id: string; name: string; slug: string | null }[] | null) ?? []).filter(
    (g): g is { id: string; name: string; slug: string } => !!g.slug,
  )
  const selectedGame = searchParams.game?.trim()
    ? allGames.find((g) => g.slug === searchParams.game!.trim()) ?? null
    : null
  const gameFilter = selectedGame?.slug ?? null

  let query = supabase
    .from('tournaments')
    .select(
      'id, title, slug, status, game_id, card_image_url, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end, games(name, icon_url, slug, category)',
    )
    .order('created_at', { ascending: false })

  const statuses = filterStatusValues(statusFilter)
  if (statuses) query = query.in('status', statuses)
  if (selectedGame) query = query.eq('game_id', selectedGame.id)

  const [{ data }, { data: paidRegs }] = await Promise.all([
    query,
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
      card_image_url: string | null
      max_players: number | null
      registration_fee: number | null
      prize_pool: number | null
      registration_start: string | null
      registration_end: string | null
      tournament_start: string | null
      tournament_end: string | null
      games: GameRef
    }
    const g = firstGame(t.games)
    return {
      id: t.id,
      title: t.title,
      slug: t.slug,
      status: t.status,
      gameName: g?.name ?? null,
      gameIconUrl: resolveTournamentImageUrl(t.card_image_url, g),
      gameCategory: g?.category ?? null,
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

  function hrefFor(params: Partial<SearchParams>) {
    const merged: SearchParams = { game: gameFilter ?? undefined, status: statusFilter, ...params }
    const sp = new URLSearchParams()
    if (merged.game) sp.set('game', merged.game)
    if (merged.status && merged.status !== 'all') sp.set('status', merged.status)
    const qs = sp.toString()
    return qs ? `/admin/tournaments?${qs}` : '/admin/tournaments'
  }

  const isFiltered = statusFilter !== 'all' || gameFilter != null

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">
          {statusFilter === 'active' ? 'Active tournaments' : 'All tournaments'}
        </h2>
        <Link
          href="/admin/tournaments/new"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500"
        >
          + New tournament
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {ADMIN_TOURNAMENT_STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={hrefFor({ status: f.key })}
              className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                statusFilter === f.key
                  ? 'border-violet-500 bg-violet-500/15 text-white'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <AdminTournamentGameFilter
          games={allGames.map((g) => ({ name: g.name, slug: g.slug }))}
          value={gameFilter}
        />
      </div>

      <p className="mb-3 text-xs text-slate-500">
        {rows.length} tournament{rows.length === 1 ? '' : 's'}
        {isFiltered && (
          <>
            {' · '}
            <Link href="/admin/tournaments" className="text-violet-400 hover:text-violet-300">
              Clear filters
            </Link>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          {isFiltered ? 'No tournaments match these filters.' : 'No tournaments yet. Create the first one.'}
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

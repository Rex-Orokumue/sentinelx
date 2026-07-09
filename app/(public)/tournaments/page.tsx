import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
const PAST_LIMIT = 10

export const metadata: Metadata = {
  title: 'Tournaments — SentinelX Esports',
  description:
    'Browse live, open, and upcoming mobile esports tournaments on SentinelX Esports — Nigeria\'s Home of Mobile Esports. Compete. Win. Level Up!',
  openGraph: {
    title: 'Tournaments — SentinelX Esports',
    description:
      'Browse live, open, and upcoming mobile esports tournaments on SentinelX Esports.',
    url: `${SITE_URL}/tournaments`,
    siteName: 'SentinelX Esports',
    type: 'website',
  },
}

const SELECT_COLS =
  'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players'

type SearchParams = { game?: string; past?: string }

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = createClient()
  const gameFilter = searchParams.game?.trim() || null
  const pastAll = searchParams.past === 'all'

  // Embedded games join — inner + filtered when a game slug is active.
  const gamesSelect = gameFilter
    ? 'games!inner(name, icon_url, slug)'
    : 'games(name, icon_url, slug)'
  const cols = `${SELECT_COLS}, ${gamesSelect}`

  // Completed tournaments query, game-filtered, newest first, optional cap.
  function pastQuery(limit?: number) {
    let q = supabase.from('tournaments').select(cols).eq('status', 'completed')
    if (gameFilter) q = q.eq('games.slug', gameFilter)
    const ordered = q.order('tournament_end', { ascending: false, nullsFirst: false })
    return limit ? ordered.limit(limit) : ordered
  }

  // Live / open / upcoming query, game-filtered, newest first.
  function activeQuery() {
    let q = supabase
      .from('tournaments')
      .select(cols)
      .in('status', ['active', 'registration_open', 'registration_closed'])
    if (gameFilter) q = q.eq('games.slug', gameFilter)
    return q.order('created_at', { ascending: false })
  }

  // ── past=all: past-only view, no cap ──────────────────────────
  if (pastAll) {
    const { data } = await pastQuery()
    const past = (data ?? []) as unknown as TournamentCardData[]

    return (
      <div className="mx-auto max-w-5xl px-4 pb-20">
        <Header />
        <Link
          href={gameFilter ? `/tournaments?game=${gameFilter}` : '/tournaments'}
          className="mb-6 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          ← Back to all tournaments
        </Link>
        <h2 className="mb-4 text-base font-bold text-white">🏁 Past Tournaments</h2>
        {past.length > 0 ? (
          <Grid tournaments={past} />
        ) : (
          <EmptyState
            icon="🏁"
            title="No past tournaments yet"
            body="Completed tournaments will be archived here."
          />
        )}
        <ShareCta />
      </div>
    )
  }

  // ── default view ──────────────────────────────────────────────
  const [{ data: activeData }, { data: pastData }, { data: games }] =
    await Promise.all([
      activeQuery(),
      pastQuery(PAST_LIMIT),
      supabase.from('games').select('name, slug, icon_url').eq('active', true).order('name'),
    ])

  const activeRows = (activeData ?? []) as unknown as TournamentCardData[]
  const past = (pastData ?? []) as unknown as TournamentCardData[]

  const live = activeRows.filter((t) => t.status === 'active')
  const open = activeRows.filter((t) => t.status === 'registration_open')
  const upcoming = activeRows.filter((t) => t.status === 'registration_closed')

  const total = activeRows.length + past.length
  const gameList = games ?? []

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <Header />

      <div className="mb-6 flex items-center gap-4 text-sm">
        <Link href="/rankings" className="font-semibold text-violet-400 hover:text-violet-300">
          Rankings
        </Link>
        <Link href="/hall-of-fame" className="font-semibold text-violet-400 hover:text-violet-300">
          Hall of Fame
        </Link>
      </div>

      {gameList.length > 1 && (
        <GameFilter games={gameList} active={gameFilter} />
      )}

      {total === 0 ? (
        <EmptyState
          icon="🎮"
          title={gameFilter ? 'No tournaments for this game yet' : 'No tournaments yet'}
          body="Join the WhatsApp community to be notified when the next one drops."
        />
      ) : (
        <>
          <Section title="🔴 Live Now" tournaments={live} featureFirst />
          <Section title="🟢 Registration Open" tournaments={open} />
          <Section title="⏳ Upcoming" tournaments={upcoming} />

          {past.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-base font-bold text-white">🏁 Past Tournaments</h2>
              <Grid tournaments={past} />
              {past.length === PAST_LIMIT && (
                <div className="mt-4 text-center">
                  <Link
                    href={
                      gameFilter
                        ? `/tournaments?game=${gameFilter}&past=all`
                        : '/tournaments?past=all'
                    }
                    className="text-sm text-violet-400 hover:text-violet-300"
                  >
                    View all past tournaments →
                  </Link>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ShareCta />
    </div>
  )
}

function Header() {
  return (
    <div className="py-8">
      <h1 className="text-2xl font-black text-white">Tournaments</h1>
      <p className="mt-1 text-sm text-slate-400">
        Compete in Nigeria's mobile esports arena. Pick a tournament and register.
      </p>
    </div>
  )
}

function GameFilter({
  games,
  active,
}: {
  games: { name: string; slug: string; icon_url: string | null }[]
  active: string | null
}) {
  const chip = (isActive: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
      isActive
        ? 'border-violet-500/40 bg-violet-500/20 text-violet-300'
        : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600'
    }`

  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
      <Link href="/tournaments" className={chip(!active)}>
        All
      </Link>
      {games.map((g) => (
        <Link
          key={g.slug}
          href={`/tournaments?game=${g.slug}`}
          className={chip(active === g.slug)}
        >
          {g.name}
        </Link>
      ))}
    </div>
  )
}

function Section({
  title,
  tournaments,
  featureFirst = false,
}: {
  title: string
  tournaments: TournamentCardData[]
  featureFirst?: boolean
}) {
  if (tournaments.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">{title}</h2>
      <Grid tournaments={tournaments} featureFirst={featureFirst} />
    </section>
  )
}

function Grid({
  tournaments,
  featureFirst = false,
}: {
  tournaments: TournamentCardData[]
  featureFirst?: boolean
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tournaments.map((t, i) => (
        <TournamentCard key={t.id} tournament={t} featured={featureFirst && i === 0} />
      ))}
    </div>
  )
}

function ShareCta() {
  const shareText = `Compete in mobile esports tournaments on SentinelX Esports 🎮 ${SITE_URL}/tournaments`
  return (
    <div className="mt-4 flex justify-center">
      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
        Share on WhatsApp
      </a>
    </div>
  )
}

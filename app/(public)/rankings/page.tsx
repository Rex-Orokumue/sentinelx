import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'
import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { winsByPlayerAndGame, scoreStatsByPlayerAndCategory, type GameScopedMatch } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import { LeaderboardTabs } from '@/components/rankings/LeaderboardTabs'
import { EmptyState } from '@/components/shared/EmptyState'
import { SentinelBubble } from '@/components/ui/SentinelBubble'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { formatNaira } from '@/lib/format'

export const metadata = buildMetadata({
  title: 'Leaderboards — Sentinel X',
  description: "Nigeria's top mobile esports players on Sentinel X, ranked by SX Score.",
  path: '/rankings',
  image: DEFAULT_OG_IMAGE,
})

type RawGameRef = { name: string; category: string } | { name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function RankingsPage() {
  const supabase = createClient()
  const [
    { data: profiles },
    { data: matchRows },
    { data: activeGames },
    { count: matchCount },
    { data: prizeRows },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES)
      .order('wins', { ascending: false })
      .limit(200),
    // Fetched once and shared by both winsByPlayerAndGame and the per-category
    // aggregates below — never fetch completed matches twice.
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(name, category))',
      )
      .eq('status', 'completed'),
    // Independent of match data — a category can be "active" (a tab should
    // show) even with zero completed matches played in it yet.
    supabase.from('games').select('category').eq('active', true),
    supabase.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('tournaments').select('prize_pool').eq('status', 'completed'),
    supabase.auth.getUser(),
  ])

  const activeCategories = Array.from(new Set((activeGames ?? []).map((g) => g.category)))
  const prizesAwarded = (prizeRows ?? []).reduce((sum, r) => sum + (r.prize_pool ?? 0), 0)

  const rawMatches = ((matchRows as unknown[] | null) ?? []) as {
    status: string
    score_a: number | null
    score_b: number | null
    player_a_id: string | null
    player_b_id: string | null
    tournament: RawTournamentRef
  }[]
  const matches: GameScopedMatch[] = rawMatches.map((m) => {
    const t = firstTournamentRef(m.tournament)
    const g = firstGameRef(t?.game ?? null)
    return {
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      player_a_id: m.player_a_id,
      player_b_id: m.player_b_id,
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const winsMap = winsByPlayerAndGame(matches)
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))

  const players: PlayerStatsInput[] = (profiles ?? []).map(
    (p): PlayerStatsInput => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      country: p.country,
      wins: p.wins,
      losses: p.losses,
      totalMatches: p.total_matches,
      goalsScored: p.goals_scored,
      goalsConceded: p.goals_conceded,
      categoryStats: categoryMaps.map(({ category, map }) => ({
        category,
        scored: map.get(p.id)?.scored ?? 0,
        conceded: map.get(p.id)?.conceded ?? 0,
      })),
      winsByGame: winsMap.get(p.id) ?? [],
      totalTitles: p.total_titles,
      sentinelScore: p.sentinel_score,
      sentinelTier: p.sentinel_tier,
    }),
  )

  const viewer = user ? players.find((p) => p.id === user.id) ?? null : null
  const topScore = [...players].sort((a, b) => b.sentinelScore - a.sentinelScore)[0] ?? null
  const topTitles = [...players].sort((a, b) => b.totalTitles - a.totalTitles)[0] ?? null
  const topWinRate =
    [...players]
      .filter((p) => p.totalMatches > 0)
      .sort((a, b) => b.wins / b.totalMatches - a.wins / a.totalMatches)[0] ?? null

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative mb-10 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sx-purple/25 blur-[100px]"
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-14 lg:py-16 lg:pr-64 xl:pr-80">
          <div className="text-center lg:text-left">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Leaderboards</p>
            <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
              All Games
              <br />
              <span className="text-sx-purple-text">Global Rankings</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-sm text-sx-gray sm:text-base lg:mx-0">
              Players are ranked by their total SX Score across all games they compete in.
            </p>
          </div>
        </div>

        {/* mascot-leaderboards.png is the Games-page pose reused, not the mockup's
            own pointing-toward-trophy render — placeholder until the exact one lands. */}
        <ImagePlaceholder
          className="relative mx-auto -mt-2 h-64 w-52 pb-8 sm:h-80 sm:w-64 lg:absolute lg:inset-y-0 lg:right-4 lg:mx-0 lg:h-auto lg:w-64 lg:pb-0 xl:right-8 xl:w-80"
          label={'Sentinel mascot — pointing pose, trophy line-art backdrop\n(public/mascot/mascot-leaderboards.png)'}
        />
      </section>

      {/* ── Stats bar ─────────────────────────────────────────── */}
      <section className="mb-10 grid grid-cols-2 gap-4 rounded-xl border border-sx-border bg-sx-surface p-6 sm:grid-cols-4">
        <StatItem icon="👥" value={String(players.length)} label="Players Ranked" />
        <StatItem icon="🎮" value={String(activeCategories.length)} label="Categories Included" />
        <StatItem icon="⚔️" value={String(matchCount ?? 0)} label="Total Matches" />
        <StatItem icon="🏆" value={formatNaira(prizesAwarded)} label="Prizes Awarded" />
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* ── Right: sidebars (shown first on mobile) ── */}
        <aside className="order-first space-y-6 lg:order-last">
          <YourGlobalStatsCard viewer={viewer} isLoggedIn={!!user} />
          <TopPerformersCard topScore={topScore} topTitles={topTitles} topWinRate={topWinRate} />
        </aside>

        {/* ── Left: leaderboard table ─────────────────────── */}
        <div className="min-w-0">
          <LeaderboardTabs players={players} currentUserId={user?.id ?? null} activeCategories={activeCategories} />
          {players.length === 0 && (
            <EmptyState icon="🏅" title="Rankings coming soon" body="Be the first to compete and claim the top spot." />
          )}
        </div>
      </div>

      {/* ── CTA banner ────────────────────────────────────────── */}
      <section className="mt-10 rounded-xl border border-sx-border bg-gradient-to-r from-sx-purple/20 to-transparent p-8 text-center sm:text-left">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div>
            <p className="font-display text-xl font-black uppercase text-white">
              Compete in more games. Earn more glory.
            </p>
            <p className="mt-1 text-sm text-sx-gray">The more games you play, the higher you rise.</p>
          </div>
          <Link
            href="/tournaments"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sx-purple-light"
          >
            <Trophy className="h-4 w-4" /> Explore Tournaments →
          </Link>
        </div>
      </section>

      <SentinelBubble variant="leaderboards" />
    </div>
  )
}

function StatItem({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="font-display text-lg font-black text-white">{value}</p>
        <p className="text-[11px] uppercase tracking-wide text-sx-gray">{label}</p>
      </div>
    </div>
  )
}

function YourGlobalStatsCard({ viewer, isLoggedIn }: { viewer: PlayerStatsInput | null; isLoggedIn: boolean }) {
  if (!isLoggedIn) {
    return (
      <div className="rounded-xl border border-sx-border bg-sx-surface p-6 text-center">
        <Trophy className="mx-auto mb-3 h-8 w-8 text-sx-purple-text" />
        <p className="mb-3 text-sm text-sx-gray">Sign in to see your stats</p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
        >
          Sign In
        </Link>
      </div>
    )
  }

  if (!viewer) {
    return (
      <div className="rounded-xl border border-sx-border bg-sx-surface p-6 text-center">
        <Trophy className="mx-auto mb-3 h-8 w-8 text-sx-purple-text" />
        <p className="text-sm text-sx-gray">
          Play {RANKING_MIN_MATCHES}+ matches to appear on the leaderboard.
        </p>
      </div>
    )
  }

  const winRate = viewer.totalMatches > 0 ? Math.round((viewer.wins / viewer.totalMatches) * 100) : 0

  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-6 text-center">
      <Trophy className="mx-auto mb-3 h-9 w-9 text-sx-purple-text" />
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Your Global Stats</p>
      <p className="mb-4 font-display text-3xl font-black text-white">{viewer.sentinelScore} SX Score</p>
      <div className="grid grid-cols-2 gap-3 text-left text-xs">
        <Stat label="Matches Played" value={viewer.totalMatches} />
        <Stat label="Total Wins" value={viewer.wins} />
        <Stat label="Win Rate" value={`${winRate}%`} />
        <Stat label="Titles Won" value={viewer.totalTitles} />
      </div>
      <Link
        href={viewer.username ? `/players/${viewer.username}` : '/dashboard'}
        className="mt-5 block rounded-lg border border-sx-border px-4 py-2.5 text-xs font-bold text-white transition-colors hover:border-sx-purple/40"
      >
        View Full Profile →
      </Link>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="font-display text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-sx-gray">{label}</p>
    </div>
  )
}

function TopPerformersCard({
  topScore,
  topTitles,
  topWinRate,
}: {
  topScore: PlayerStatsInput | null
  topTitles: PlayerStatsInput | null
  topWinRate: PlayerStatsInput | null
}) {
  const rows = [
    { label: 'Most SX Score', player: topScore, value: topScore ? String(topScore.sentinelScore) : '—' },
    { label: 'Most Titles Won', player: topTitles, value: topTitles ? String(topTitles.totalTitles) : '—' },
    {
      label: 'Highest Win Rate',
      player: topWinRate,
      value:
        topWinRate && topWinRate.totalMatches > 0
          ? `${Math.round((topWinRate.wins / topWinRate.totalMatches) * 100)}%`
          : '—',
    },
  ]

  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Top Performers</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-sx-gray">{r.label}</p>
              <p className="truncate text-sm font-semibold text-white">
                {r.player?.displayName ?? r.player?.username ?? '—'}
              </p>
            </div>
            <span className="shrink-0 font-display text-sm font-black text-sx-purple-text">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

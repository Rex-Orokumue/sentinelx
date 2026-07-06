import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { rankPlayers, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { LeaderboardTable } from '@/components/rankings/LeaderboardTable'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Rankings — Sentinel X',
  description: "Nigeria's top mobile esports players on Sentinel X, ranked by wins.",
  openGraph: {
    title: 'Rankings — Sentinel X',
    description: "Nigeria's top mobile esports players, ranked by wins.",
    url: `${SITE_URL}/rankings`,
    siteName: 'Sentinel X',
    type: 'website',
  },
}

export default async function RankingsPage() {
  const supabase = createClient()
  const [{ data: profiles }, { data: { user } }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sentinel_score, sentinel_tier',
      )
      .gt('total_matches', 0)
      .order('wins', { ascending: false })
      .limit(200),
    supabase.auth.getUser(),
  ])

  const players = rankPlayers(
    (profiles ?? []).map(
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
        totalTitles: p.total_titles,
        sentinelScore: p.sentinel_score,
        sentinelTier: p.sentinel_tier,
      }),
    ),
  )

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Rankings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Nigeria&apos;s top mobile esports players, ranked by wins.
        </p>
      </div>

      {players.length === 0 ? (
        <EmptyState
          icon="🏅"
          title="Rankings coming soon"
          body="Be the first to compete and claim the top spot."
        />
      ) : (
        <LeaderboardTable players={players} currentUserId={user?.id ?? null} />
      )}
    </div>
  )
}

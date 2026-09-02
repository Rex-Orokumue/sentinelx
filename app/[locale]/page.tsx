import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { PromoBanner } from '@/components/home/PromoBanner'
import { Hero } from '@/components/home/Hero'
import { LiveTournamentStrip } from '@/components/home/LiveTournamentStrip'
import { FourPillars } from '@/components/home/FourPillars'
import { LeaderboardRow } from '@/components/home/LeaderboardRow'
import { HallOfFameTeaser } from '@/components/home/HallOfFameTeaser'
import { HowItWorks } from '@/components/home/HowItWorks'
import { HomeFinalCta } from '@/components/home/HomeFinalCta'
import { buildHallOfFameTeaserData, type HallOfFameTeaserData } from '@/lib/home/hall-of-fame-teaser'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { getTranslations } from 'next-intl/server'
import { homepageDescription } from '@/lib/seo/homepage-description'
import { FaqSection } from '@/components/home/FaqSection'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'
import { HOMEPAGE_FAQS } from '@/lib/seo/faq-content'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params
  const supabase = createClient()
  const { data: liveTournament } = await supabase
    .from('tournaments')
    .select('title')
    .in('status', ['active', 'registration_open'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return buildMetadata({
    title: 'SentinelX Esports — Home',
    description: homepageDescription(liveTournament?.title ?? null),
    path: '/',
    locale,
  })
}

export default async function HomePage() {
  const t = await getTranslations('home')
  const common = await getTranslations('common')
  const supabase = createClient()

  const [
    { data: rawTournaments },
    { data: players },
    { data: rawBanner },
    { data: completedTournaments },
    { count: playerCount },
    { count: tournamentCount },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type, card_image_url, games(name, icon_url, slug, category)'
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, wins, total_matches, sx_score, sentinel_tier, membership_tier')
      .order('wins', { ascending: false })
      .gt('total_matches', 0)
      .limit(5),
    supabase
      .from('homepage_banners')
      .select('title, image_url, link_url')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Hero's "Prizes Paid Out" stat. Summed client-side (not a huge dataset —
    // one row per completed tournament) rather than a DB aggregate/RPC, matching
    // this file's existing style of plain selects + counts.
    supabase.from('tournaments').select('prize_pool').eq('status', 'completed'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).neq('status', 'draft'),
  ])

  const prizesPaidOut = (completedTournaments ?? []).reduce((sum, t) => sum + (t.prize_pool ?? 0), 0)

  const { data: championsCupRow } = await supabase
    .from('tournaments')
    .select('id, slug, title, tournament_end, prize_pool, games(name)')
    .eq('tournament_type', 'champions_cup')
    .eq('status', 'completed')
    .order('tournament_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  let hallOfFameTeaserData: HallOfFameTeaserData | null = null
  if (championsCupRow) {
    const { data: rawFinalMatchRow } = await supabase
      .from('matches')
      .select(
        'id, round, status, score_a, score_b, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', championsCupRow.id)
      .eq('round', 'final')
      .eq('status', 'completed')
      .maybeSingle()

    // Supabase's typegen can't resolve this FK-embed select shape (falls back
    // to a GenericStringError type) — same issue
    // app/(public)/hall-of-fame/page.tsx works around with an explicit cast.
    // The embed can also arrive as an object or a single-element array
    // depending on the inferred relationship; normalized below, matching that
    // file's `newFinalRows` handling for the identical join.
    type EmbeddedProfile = { id: string; username: string | null; display_name: string | null }
    const finalMatchRow = rawFinalMatchRow as unknown as {
      id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: EmbeddedProfile | EmbeddedProfile[] | null
      player_b: EmbeddedProfile | EmbeddedProfile[] | null
    } | null

    const firstProfile = (p: EmbeddedProfile | EmbeddedProfile[] | null): EmbeddedProfile | null =>
      Array.isArray(p) ? (p[0] ?? null) : p

    const playerA = finalMatchRow ? firstProfile(finalMatchRow.player_a) : null
    const playerB = finalMatchRow ? firstProfile(finalMatchRow.player_b) : null

    const finalMatch: BracketMatch | null = finalMatchRow
      ? {
          id: finalMatchRow.id,
          round: finalMatchRow.round,
          group_id: null,
          groupName: null,
          status: finalMatchRow.status,
          score_a: finalMatchRow.score_a,
          score_b: finalMatchRow.score_b,
          scheduled_at: null,
          is_full_day: false,
          playerA: { id: playerA?.id ?? '', name: playerA?.display_name ?? playerA?.username ?? 'TBD' },
          playerB: { id: playerB?.id ?? '', name: playerB?.display_name ?? playerB?.username ?? 'TBD' },
        }
      : null

    const gameName = Array.isArray(championsCupRow.games)
      ? (championsCupRow.games[0]?.name ?? null)
      : (championsCupRow.games?.name ?? null)

    hallOfFameTeaserData = buildHallOfFameTeaserData(
      {
        id: championsCupRow.id,
        slug: championsCupRow.slug,
        title: championsCupRow.title,
        tournament_end: championsCupRow.tournament_end,
        prize_pool: championsCupRow.prize_pool,
        gameName,
      },
      finalMatch,
    )
  }

  const banner = rawBanner
    ? { title: rawBanner.title, imageUrl: rawBanner.image_url, linkUrl: rawBanner.link_url }
    : null

  // Ensure any 'active' tournament shows first as featured
  const tournaments = [...(rawTournaments ?? [])].sort((a, b) =>
    a.status === 'active' && b.status !== 'active' ? -1
    : b.status === 'active' && a.status !== 'active' ? 1
    : 0
  ) as TournamentCardData[]

  const featured  = tournaments[0] ?? null
  const upcoming  = tournaments.slice(1)
  const leaderboard = players ?? []

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">

      <Hero
        playerCount={playerCount ?? 0}
        tournamentCount={tournamentCount ?? 0}
        prizesPaidOut={prizesPaidOut}
      />

      <LiveTournamentStrip tournament={featured} />

      <FourPillars />

      {/* ── Upcoming Tournaments ─────────────────────────────── */}
      {upcoming.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-white">{t('upcomingHeading')}</h2>
            <Link href="/tournaments" className="text-sm font-semibold text-sx-purple-text hover:text-white">
              {common('viewAll')} →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((t) => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </div>
        </section>
      )}

      {/* ── Leaderboard Preview ──────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{`🏆 ${t('topPlayersHeading')}`}</h2>
          <Link href="/rankings" className="text-sm font-semibold text-sx-purple-text hover:text-white">
            {t('fullRankingsLink')} →
          </Link>
        </div>

        {leaderboard.length === 0 ? (
          <EmptyState
            icon="🏅"
            title="Rankings coming soon"
            body="Be the first to compete and claim the top spot."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {leaderboard.map((player, i) => (
              <LeaderboardRow key={player.id} player={player} rank={i + 1} />
            ))}
          </div>
        )}
      </section>

      <HallOfFameTeaser data={hallOfFameTeaserData} />

      <HowItWorks />

      <PromoBanner banner={banner} />

      <HomeFinalCta />

      <FaqSection items={HOMEPAGE_FAQS} />
      <JsonLd data={buildFaqJsonLd(HOMEPAGE_FAQS)} />

    </div>
  )
}

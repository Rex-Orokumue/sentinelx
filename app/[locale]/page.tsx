import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TournamentCard } from '@/components/tournament/TournamentCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { PromoBanner } from '@/components/home/PromoBanner'
import { Hero } from '@/components/home/Hero'
import { LiveTournamentStrip } from '@/components/home/LiveTournamentStrip'
import { FourPillars } from '@/components/home/FourPillars'
import { LeaderboardRow } from '@/components/home/LeaderboardRow'
import { HallOfFameTeaser } from '@/components/home/HallOfFameTeaser'
import { HowItWorks } from '@/components/home/HowItWorks'
import { HomeFinalCta } from '@/components/home/HomeFinalCta'
import { buildHomeSummary } from '@/lib/home/summary'
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

  const summary = await buildHomeSummary(supabase)
  const { banner, hallOfFame: hallOfFameTeaserData, stats } = summary
  const featured = summary.featuredTournament
  const upcoming = summary.upcomingTournaments
  const leaderboard = summary.leaderboardTeaser
  const { playerCount, tournamentCount, prizesPaidOut } = stats

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

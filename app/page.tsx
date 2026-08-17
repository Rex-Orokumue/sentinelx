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
import { buildHallOfFameTeaserData, type HallOfFameTeaserData } from '@/lib/home/hall-of-fame-teaser'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { SentinelBubble } from '@/components/ui/SentinelBubble'
import { buildMetadata } from '@/lib/seo/metadata'
import { homepageDescription } from '@/lib/seo/homepage-description'
import { FaqSection } from '@/components/home/FaqSection'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/seo/schema/faq'
import { HOMEPAGE_FAQS } from '@/lib/seo/faq-content'

const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export async function generateMetadata(): Promise<Metadata> {
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
  })
}

export default async function HomePage() {
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
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type, games(name, icon_url)'
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

  const shareText = `Play mobile esports in Nigeria on SentinelX Esports — Compete. Win. Level Up! ${SITE_URL}`

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">

      <Hero
        playerCount={playerCount ?? 0}
        tournamentCount={tournamentCount ?? 0}
        prizesPaidOut={prizesPaidOut}
      />

      <LiveTournamentStrip tournament={featured} />

      <FourPillars />

      <PromoBanner banner={banner} />

      {/* ── Upcoming Tournaments ─────────────────────────────── */}
      {upcoming.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Upcoming</h2>
            <Link href="/tournaments" className="text-sm font-semibold text-sx-purple-text hover:text-white">
              View all →
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
          <h2 className="text-base font-bold text-white">🏆 Top Players</h2>
          <Link href="/rankings" className="text-sm font-semibold text-sx-purple-text hover:text-white">
            Full Rankings →
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

      {/* ── WhatsApp Community CTA ───────────────────────────── */}
      <section className="rounded-xl border border-[#25D366]/20 bg-[#25D366]/5 p-8 text-center">
        <p className="mb-3 text-4xl">💬</p>
        <h2 className="mb-2 text-xl font-bold text-white">Join Our WhatsApp Community</h2>
        <p className="mb-6 text-sm text-sx-gray">
          Get tournament alerts, live match updates, and connect with Nigerian mobile gamers.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={WHATSAPP_COMMUNITY}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-[#25D366] px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 sm:w-auto"
          >
            <WhatsAppIcon />
            Join Community
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-lg border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10 sm:w-auto"
          >
            <WhatsAppIcon />
            Share on WhatsApp
          </a>
        </div>
      </section>

      <FaqSection items={HOMEPAGE_FAQS} />
      <JsonLd data={buildFaqJsonLd(HOMEPAGE_FAQS)} />

      <SentinelBubble variant="home" />
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

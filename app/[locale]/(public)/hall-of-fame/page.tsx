import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import {
  pickMVP,
  pickCategoryAward,
  pickGameAward,
  deriveThirdPlaces,
  type ThirdPlaceInput,
} from '@/lib/hall-of-fame/awards'
import { deriveTournamentResults } from '@/lib/hall-of-fame/tournament-results'
import {
  scoreStatsByPlayerAndCategory,
  scoreStatsByPlayerAndGame,
  categoryStat,
  gameStat,
  type GameScopedMatch,
} from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { SectionHeader } from '@/components/hall-of-fame/SectionHeader'
import { HeroSection } from '@/components/hall-of-fame/HeroSection'
import { AllTimeAwardCard, AllTimeAwardEmptyCard } from '@/components/hall-of-fame/AllTimeAwardCard'
import { CategoryAwardFilter, type AwardOption } from '@/components/hall-of-fame/CategoryAwardFilter'
import { ChampionsCupCard, ChampionsCupEmptyCard } from '@/components/hall-of-fame/ChampionsCupCard'
import { MastersChampionCard, MastersChampionEmptyCard } from '@/components/hall-of-fame/MastersChampionCard'
import { CommunityClubCard } from '@/components/hall-of-fame/CommunityClubCard'
import { BronzeCard } from '@/components/hall-of-fame/BronzeCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Hall of Fame — Sentinel X',
    description: "Sentinel X champions, MVP, and Golden Boot — the all-time honors of Nigeria's home of mobile esports.",
    path: '/hall-of-fame',
    image: DEFAULT_OG_IMAGE,
    locale,
  })
}

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

// Supabase to-one embeds can arrive as an object or a single-element array; normalize.
function firstGameName(games: unknown): string | null {
  if (Array.isArray(games)) return (games[0] as { name?: string } | undefined)?.name ?? null
  return (games as { name?: string } | null)?.name ?? null
}

type RawGameRef = { id: string; name: string; category: string } | { id: string; name: string; category: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function firstGameRef(g: RawGameRef): { id: string; name: string; category: string } | null {
  return Array.isArray(g) ? g[0] ?? null : g
}
function firstTournamentRef(t: RawTournamentRef): { game: RawGameRef } | null {
  return Array.isArray(t) ? t[0] ?? null : t
}

export default async function HallOfFamePage() {
  const supabase = createClient()

  // Awards: eligible profiles. Champions: completed tournaments + their completed finals.
  const [
    { data: profileRows },
    { data: tournamentRows },
    { data: matchRows },
    { data: activeGames },
    { data: mastersRows },
    { data: communityClubRows },
    { data: championsCupRows },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sx_score, sentinel_tier, membership_tier',
      )
      .gte('total_matches', RANKING_MIN_MATCHES),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, games(name)')
      .eq('status', 'completed'),
    supabase
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, tournament:tournaments(game:games(id, name, category))',
      )
      .eq('status', 'completed'),
    // Independent of match data — a category can be "active" even with zero
    // completed matches played in it yet.
    supabase.from('games').select('id, name, category').eq('active', true),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, prize_pool, season:seasons(name)')
      .eq('tournament_type', 'masters')
      .eq('status', 'completed')
      .order('tournament_end', { ascending: false }),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, prize_pool')
      .eq('tournament_type', 'community_club')
      .eq('status', 'completed')
      .order('tournament_end', { ascending: false })
      .limit(9),
    supabase
      .from('tournaments')
      .select('id, slug, title, tournament_end, prize_pool, season:seasons(name)')
      .eq('tournament_type', 'champions_cup')
      .eq('status', 'completed')
      .order('tournament_end', { ascending: false })
      .limit(1),
  ])

  const activeCategories = Array.from(new Set((activeGames ?? []).map((g) => g.category)))

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
      game_id: g?.id ?? 'unknown',
      game_name: g?.name ?? 'Unknown',
      game_category: g?.category ?? 'other',
    }
  })
  const categoryMaps = Object.keys(CATEGORY_META).map((category) => ({
    category,
    map: scoreStatsByPlayerAndCategory(matches, category),
  }))
  const gameMaps = (activeGames ?? []).map((g) => ({
    gameId: g.id,
    map: scoreStatsByPlayerAndGame(matches, g.id),
  }))

  const players: PlayerStatsInput[] = (profileRows ?? []).map((p) => ({
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
    gameStats: gameMaps.map(({ gameId, map }) => ({
      gameId,
      scored: map.get(p.id)?.scored ?? 0,
      conceded: map.get(p.id)?.conceded ?? 0,
    })),
    winsByGame: [],
    totalTitles: p.total_titles,
    sxScore: p.sx_score,
    sentinelTier: p.sentinel_tier,
    membershipTier: p.membership_tier,
  }))

  function awardOptionsFor(category: string): AwardOption[] {
    const allWinner = pickCategoryAward(players, category)
    const options: AwardOption[] = [
      {
        gameId: null,
        gameLabel: `All ${CATEGORY_META[category]?.statLabel ?? category}`,
        winner: allWinner,
        metricValue: allWinner ? categoryStat(allWinner.categoryStats, category).scored : 0,
      },
    ]
    const gamesInCategory = (activeGames ?? []).filter((g) => g.category === category)
    if (gamesInCategory.length > 1) {
      for (const g of gamesInCategory) {
        const winner = pickGameAward(players, g.id)
        options.push({
          gameId: g.id,
          gameLabel: g.name,
          winner,
          metricValue: winner ? gameStat(winner.gameStats, g.id).scored : 0,
        })
      }
    }
    return options
  }

  const mvp = pickMVP(players)
  const goldenBootOptions = awardOptionsFor('football')
  const goldenBoot = goldenBootOptions[0]?.winner ?? null
  const categoryAwards = activeCategories
    .filter((c) => c !== 'football' && CATEGORY_META[c] != null)
    .map((c) => ({ category: c, meta: CATEGORY_META[c], options: awardOptionsFor(c) }))
    .filter((a) => a.options[0]?.winner != null)

  // Fetch completed final matches for the completed tournaments, then attach to each.
  const tournaments = (tournamentRows ?? []) as unknown as {
    id: string
    slug: string
    title: string
    tournament_end: string | null
    games: unknown
  }[]
  const tournamentIds = tournaments.map((t) => t.id)

  const { data: thirdPlaceRows } =
    tournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
          )
          .in('tournament_id', tournamentIds)
          .eq('round', 'third_place')
          .in('status', ['completed', 'bye'])
      : { data: [] as unknown[] }

  const thirdPlaceByTournament = new Map<string, BracketMatch>()
  for (const raw of (thirdPlaceRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string
      tournament_id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    thirdPlaceByTournament.set(m.tournament_id, {
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    })
  }

  const thirdPlaceInputs: ThirdPlaceInput[] = tournaments.map((t) => ({
    tournamentId: t.id,
    slug: t.slug,
    title: t.title,
    gameName: firstGameName(t.games),
    tournamentEnd: t.tournament_end,
    thirdPlaceMatch: thirdPlaceByTournament.get(t.id) ?? null,
  }))
  const thirdPlaces = deriveThirdPlaces(thirdPlaceInputs)

  const hasAwards = mvp != null || goldenBoot != null || categoryAwards.length > 0
  const hasBronze = thirdPlaces.length > 0

  // ── Masters / Community Club / Champions Cup champions + runner-ups ────
  const mastersIds = (mastersRows ?? []).map((t) => t.id)
  const communityClubIds = (communityClubRows ?? []).map((t) => t.id)
  const championsCupIds = (championsCupRows ?? []).map((t) => t.id)
  const newTournamentIds = [...mastersIds, ...communityClubIds, ...championsCupIds]

  const { data: newFinalRows } =
    newTournamentIds.length > 0
      ? await supabase
          .from('matches')
          .select(
            'id, tournament_id, round, status, score_a, score_b, ' +
              'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, avatar_url, membership_tier, sentinel_tier), ' +
              'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, avatar_url, membership_tier, sentinel_tier)',
          )
          .in('tournament_id', newTournamentIds)
          .eq('round', 'final')
          .eq('status', 'completed')
      : { data: [] as unknown[] }

  type ProfileWithAvatarRef = {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
    membership_tier: string | null
    sentinel_tier: string | null
  }
  const newFinalByTournament = new Map<string, BracketMatch>()
  const playerInfoById = new Map<string, ProfileWithAvatarRef>()
  for (const raw of (newFinalRows as unknown[] | null) ?? []) {
    const m = raw as {
      id: string
      tournament_id: string
      round: string
      status: string
      score_a: number | null
      score_b: number | null
      player_a: ProfileWithAvatarRef | ProfileWithAvatarRef[] | null
      player_b: ProfileWithAvatarRef | ProfileWithAvatarRef[] | null
    }
    const a = Array.isArray(m.player_a) ? m.player_a[0] ?? null : m.player_a
    const b = Array.isArray(m.player_b) ? m.player_b[0] ?? null : m.player_b
    if (a) playerInfoById.set(a.id, a)
    if (b) playerInfoById.set(b.id, b)
    newFinalByTournament.set(m.tournament_id, {
      id: m.id,
      round: m.round,
      group_id: null,
      groupName: null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: null,
      is_full_day: false,
      playerA: { id: a?.id ?? '', name: a?.display_name ?? a?.username ?? 'TBD' },
      playerB: { id: b?.id ?? '', name: b?.display_name ?? b?.username ?? 'TBD' },
    })
  }

  type SeasonRef = { name: string } | { name: string }[] | null
  const seasonName = (s: SeasonRef) => (Array.isArray(s) ? s[0]?.name : s?.name) ?? null

  const mastersResults = deriveTournamentResults(
    (mastersRows ?? []).map((t) => ({
      tournamentId: t.id,
      slug: t.slug,
      title: t.title,
      prizePool: t.prize_pool,
      tournamentEnd: t.tournament_end,
      finalMatch: newFinalByTournament.get(t.id) ?? null,
    })),
  )
  const communityClubResults = deriveTournamentResults(
    (communityClubRows ?? []).map((t) => ({
      tournamentId: t.id,
      slug: t.slug,
      title: t.title,
      prizePool: t.prize_pool,
      tournamentEnd: t.tournament_end,
      finalMatch: newFinalByTournament.get(t.id) ?? null,
    })),
  )
  const championsCupResult =
    deriveTournamentResults(
      (championsCupRows ?? []).map((t) => ({
        tournamentId: t.id,
        slug: t.slug,
        title: t.title,
        prizePool: t.prize_pool,
        tournamentEnd: t.tournament_end,
        finalMatch: newFinalByTournament.get(t.id) ?? null,
      })),
    )[0] ?? null
  const championsCupSeasonName = championsCupResult
    ? seasonName((championsCupRows ?? []).find((t) => t.id === championsCupResult.tournamentId)?.season ?? null)
    : null

  // Achievement slugs for the Champions Cup champion's HexAvatar decorations.
  const { data: cupChampAchievements } = championsCupResult
    ? await supabase.from('player_achievements').select('achievements(slug)').eq('player_id', championsCupResult.champion.id)
    : { data: [] as unknown[] }
  const cupChampionSlugs = ((cupChampAchievements as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })

  return (
    <>
      <HeroSection />
      <div className="mx-auto max-w-3xl px-4 pb-20">
        <section className="border-b border-amber-500/10 py-16">
          <SectionHeader icon="☀️" title="All-Time Awards" subtitle="The greatest individuals in SentinelX history." tone="gold" />
          {hasAwards ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row">
                {mvp ? (
                  <AllTimeAwardCard
                    label="MVP"
                    icon="⭐"
                    avatarUrl={mvp.avatarUrl}
                    name={mvp.displayName ?? mvp.username ?? 'Anonymous'}
                    membershipTier={mvp.membershipTier}
                    sentinelTier={mvp.sentinelTier}
                    metricLabel="SX Score"
                    metricValue={mvp.sxScore}
                    awardName="All-Time MVP"
                  />
                ) : (
                  <AllTimeAwardEmptyCard label="MVP" icon="⭐" />
                )}
                <CategoryAwardFilter
                  label="Golden Boot"
                  icon="👟"
                  metricLabel="goals scored"
                  awardName="All-Time Golden Boot"
                  options={goldenBootOptions}
                />
              </div>
              {categoryAwards.length > 0 && (
                <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                  {categoryAwards.map(({ category, meta, options }) => (
                    <CategoryAwardFilter
                      key={category}
                      label={meta.awardName}
                      icon={meta.awardEmoji}
                      metricLabel={meta.statLabel.toLowerCase()}
                      awardName={meta.awardName}
                      options={options}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              <AllTimeAwardEmptyCard label="MVP" icon="⭐" />
              <AllTimeAwardEmptyCard label="Golden Boot" icon="👟" />
            </div>
          )}
        </section>

        <section
          className="border-y border-sx-purple/30 py-16"
          style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%)' }}
        >
          <SectionHeader
            icon="🏆"
            title="Champions Cup Legends"
            subtitle="The greatest prize in Nigerian mobile esports. Annual · Invitation Only."
            tone="purple"
          />
          {championsCupResult ? (
            <ChampionsCupCard
              avatarUrl={playerInfoById.get(championsCupResult.champion.id)?.avatar_url ?? null}
              name={championsCupResult.champion.name}
              achievements={cupChampionSlugs}
              sentinelTier={playerInfoById.get(championsCupResult.champion.id)?.sentinel_tier ?? null}
              slug={championsCupResult.slug}
              date={championsCupResult.date}
              prizePool={championsCupResult.prizePool}
              seasonName={championsCupSeasonName}
            />
          ) : (
            <ChampionsCupEmptyCard />
          )}
        </section>

        <section className="border-t border-amber-500/20 py-16">
          <SectionHeader icon="👑" title="Masters Champions" subtitle="Monthly elite champions — the top 16 per month, competing for the prize." tone="gold" />
          {mastersResults.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {mastersResults.map((r) => (
                <MastersChampionCard
                  key={r.tournamentId}
                  title={r.title}
                  avatarUrl={playerInfoById.get(r.champion.id)?.avatar_url ?? null}
                  name={r.champion.name}
                  membershipTier={playerInfoById.get(r.champion.id)?.membership_tier ?? null}
                  sentinelTier={playerInfoById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug}
                  prizePool={r.prizePool}
                  runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <MastersChampionEmptyCard title="August 2026 Masters" />
          )}
        </section>

        <section className="py-16">
          <SectionHeader icon="⚡" title="Community Club Champions" subtitle="Weekly community tournaments — where every legend starts." />
          {communityClubResults.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {communityClubResults.map((r) => (
                <CommunityClubCard
                  key={r.tournamentId}
                  avatarUrl={playerInfoById.get(r.champion.id)?.avatar_url ?? null}
                  name={r.champion.name}
                  membershipTier={playerInfoById.get(r.champion.id)?.membership_tier ?? null}
                  sentinelTier={playerInfoById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug}
                  title={r.title}
                  date={r.date}
                  runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon="⚡" title="No Community Club champions yet" body="Weekly champions appear here once a tournament finishes." />
          )}
        </section>

        <section className="py-16">
          <SectionHeader icon="🥉" title="Bronze Finishes" subtitle="Third-place finishers across every tournament." />
          {hasBronze ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {thirdPlaces.map((tp) => (
                <BronzeCard key={tp.tournamentId} playerName={tp.player.name} slug={tp.slug} title={tp.title} gameName={tp.gameName} date={tp.date} />
              ))}
            </div>
          ) : (
            <EmptyState icon="🥉" title="No third place finishes yet" body="3rd place winners appear here once a bronze match is confirmed." />
          )}
        </section>
      </div>
    </>
  )
}

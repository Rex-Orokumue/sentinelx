import { createClient } from '@/lib/supabase/server'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import {
  pickMVP,
  pickCategoryAward,
  pickGameAward,
  deriveThirdPlaces,
  type ThirdPlaceInput,
} from '@/lib/hall-of-fame/awards'
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
import { TournamentChampionCard } from '@/components/hall-of-fame/TournamentChampionCard'
import { HallOfFameGameFilter } from '@/components/hall-of-fame/HallOfFameGameFilter'
import { fetchChampions, groupByType } from '@/lib/tournaments/champions'
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

export default async function HallOfFamePage({
  searchParams,
}: {
  searchParams: { game?: string }
}) {
  const supabase = createClient()
  const gameSlug = searchParams.game?.trim() || null

  // Awards: eligible profiles. Champions: completed tournaments + their completed finals.
  const [
    { data: profileRows },
    { data: tournamentRows },
    { data: matchRows },
    { data: activeGames },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, username, display_name, avatar_url, country, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sx_score, sentinel_tier, membership_tier, kyc_verified',
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
    supabase.from('games').select('id, name, slug, category').eq('active', true),
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
    kycVerified: p.kyc_verified,
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

  // ── Champions, for every tournament type and every game ────────────────
  // Champion resolution lives in lib/tournaments/champions.ts so the homepage,
  // games page and tournament page share it. Type now decides which section a
  // champion renders in — it is no longer a filter that can hide one.
  const activeGameList = (activeGames ?? []) as unknown as {
    id: string
    name: string
    slug: string
    category: string
  }[]
  const selectedGame = gameSlug ? activeGameList.find((g) => g.slug === gameSlug) ?? null : null
  // An unknown slug falls back to "all games" rather than showing nothing.
  const gameFilterId = selectedGame?.id

  const champions = await fetchChampions(supabase, gameFilterId ? { gameId: gameFilterId } : {})
  const championGroups = groupByType(champions)

  // Tier decorations for the champion cards.
  const championIds = Array.from(new Set(champions.map((c) => c.champion.id)))
  const { data: championProfileRows } = championIds.length
    ? await supabase
        .from('profiles')
        .select('id, avatar_url, membership_tier, sentinel_tier')
        .in('id', championIds)
    : { data: [] as unknown[] }
  const championProfileById = new Map<
    string,
    { avatar_url: string | null; membership_tier: string | null; sentinel_tier: string | null }
  >()
  for (const raw of (championProfileRows as unknown[] | null) ?? []) {
    const r = raw as {
      id: string
      avatar_url: string | null
      membership_tier: string | null
      sentinel_tier: string | null
    }
    championProfileById.set(r.id, r)
  }

  const cupEntry = championGroups.champions_cup[0] ?? null

  // Achievement slugs for the Champions Cup champion's HexAvatar decorations.
  const { data: cupChampAchievements } = cupEntry
    ? await supabase.from('player_achievements').select('achievements(slug)').eq('player_id', cupEntry.champion.id)
    : { data: [] as unknown[] }
  const cupChampionSlugs = ((cupChampAchievements as unknown[] | null) ?? []).flatMap((raw) => {
    const r = raw as { achievements: { slug: string } | { slug: string }[] | null }
    const ref = Array.isArray(r.achievements) ? r.achievements[0] : r.achievements
    return ref?.slug ? [ref.slug] : []
  })

  // Under a game filter an empty section is noise, so it is hidden; with no
  // filter the aspirational empty cards stay, since they signal the intended
  // competition structure.
  const showEmptySections = !selectedGame

  return (
    <>
      <HeroSection />
      <div className="mx-auto max-w-3xl px-4 pb-20">
        <div className="pt-8">
          <HallOfFameGameFilter games={activeGameList} activeSlug={selectedGame?.slug ?? null} />
        </div>
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

        {(cupEntry || showEmptySections) && (
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
          {cupEntry ? (
            <ChampionsCupCard
              avatarUrl={cupEntry.championAvatarUrl}
              name={cupEntry.champion.name}
              achievements={cupChampionSlugs}
              sentinelTier={championProfileById.get(cupEntry.champion.id)?.sentinel_tier ?? null}
              slug={cupEntry.slug}
              date={cupEntry.date}
              prizePool={cupEntry.prizePool ?? 0}
              seasonName={cupEntry.seasonName}
            />
          ) : (
            <ChampionsCupEmptyCard />
          )}
        </section>
        )}

        {(championGroups.masters.length > 0 || showEmptySections) && (
        <section className="border-t border-amber-500/20 py-16">
          <SectionHeader icon="👑" title="Masters Champions" subtitle="Monthly elite champions — the top 16 per month, competing for the prize." tone="gold" />
          {championGroups.masters.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {championGroups.masters.map((r) => (
                <MastersChampionCard
                  key={r.tournamentId}
                  title={r.title}
                  avatarUrl={r.championAvatarUrl}
                  name={r.champion.name}
                  membershipTier={championProfileById.get(r.champion.id)?.membership_tier ?? null}
                  sentinelTier={championProfileById.get(r.champion.id)?.sentinel_tier ?? null}
                  slug={r.slug}
                  prizePool={r.prizePool ?? 0}
                  runnerUpName={r.runnerUp?.name ?? null}
                />
              ))}
            </div>
          ) : (
            <MastersChampionEmptyCard title="August 2026 Masters" />
          )}
        </section>
        )}

        {(championGroups.community_club.length > 0 || showEmptySections) && (
        <section className="py-16">
          <SectionHeader icon="⚡" title="Community Club Champions" subtitle="Weekly community tournaments — where every legend starts." />
          {championGroups.community_club.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {championGroups.community_club.map((r) => (
                <CommunityClubCard
                  key={r.tournamentId}
                  avatarUrl={r.championAvatarUrl}
                  name={r.champion.name}
                  membershipTier={championProfileById.get(r.champion.id)?.membership_tier ?? null}
                  sentinelTier={championProfileById.get(r.champion.id)?.sentinel_tier ?? null}
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
        )}

        {championGroups.open.length > 0 && (
          <section className="py-16">
            <SectionHeader
              icon="🏆"
              title="Tournament Champions"
              subtitle="Every other competition across the platform."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {championGroups.open.map((entry) => (
                <TournamentChampionCard
                  key={entry.tournamentId}
                  entry={entry}
                  membershipTier={championProfileById.get(entry.champion.id)?.membership_tier ?? null}
                />
              ))}
            </div>
          </section>
        )}

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

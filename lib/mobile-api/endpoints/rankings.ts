import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { getRankings } from '@/lib/rankings/service'
import { PAGE_SIZE } from '@/lib/rankings/pagination'
import { rankPlayersBy, type LeaderboardMetric } from '@/lib/rankings/leaderboard'
import { metricLabelFor, metricTabsFor, metricValueFor } from '@/lib/rankings/tabs'
import { mapPlayerCard, mapRankingRow, rankingsMeResponseSchema, rankingsResponseSchema } from './progress-schemas'

const querySchema = z.object({
  game: z.string().trim().min(1).max(64).nullable().catch(null),
  region: z.string().trim().min(1).max(64).nullable().catch(null),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  metric: z.enum(['wins', 'score', 'football', 'fighting', 'shooter']).catch('wins'),
  tabGame: z.string().trim().min(1).max(64).nullable().catch(null),
})

function parseQuery(req: Request) {
  const sp = new URL(req.url).searchParams
  return querySchema.parse({
    game: sp.get('game'), region: sp.get('region'), page: sp.get('page') ?? 1,
    metric: sp.get('metric') ?? 'wins', tabGame: sp.get('tabGame'),
  })
}

function tabContext(
  games: { id: string; slug: string; name: string; category: string }[],
  metric: LeaderboardMetric,
  requestedSlug: string | null,
) {
  const categoryGames = games.filter((g) => g.category === metric)
  const requested = requestedSlug ? categoryGames.find((g) => g.slug === requestedSlug) : undefined
  const honored = categoryGames.length > 1 ? requested : undefined
  return {
    honored,
    subGames: categoryGames.length > 1 ? categoryGames.map((g) => ({ slug: g.slug, name: g.name })) : [],
    subGamesAllLabel: categoryGames.length > 1 ? `All ${metricLabelFor(metric)}` : null,
  }
}

function mapRow(
  p: ReturnType<typeof rankPlayersBy>[number],
  r: Awaited<ReturnType<typeof getRankings>>,
  metric: LeaderboardMetric,
  gameId: string | undefined,
  includeWinsByGame: boolean,
) {
  return mapRankingRow(p, {
    trend: r.trendByPlayer[p.id], streak: r.streakByPlayer.get(p.id) ?? 0,
    metricValue: metricValueFor(p, metric, gameId), includeWinsByGame,
    gameIdByName: new Map(r.activeGames.map((g) => [g.name, g.id])),
  })
}

export const rankingsEndpoint = defineEndpoint({
  operationId: 'getRankings', method: 'GET', path: '/rankings',
  summary: 'Public leaderboard with literal web metric-tab ordering, filters, pagination, trend and streak.',
  parameters: [
    { name: 'game', in: 'query', schema: { type: 'string', maxLength: 64 } },
    { name: 'region', in: 'query', schema: { type: 'string', maxLength: 64 } },
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
    { name: 'metric', in: 'query', schema: { type: 'string', enum: ['wins', 'score', 'football', 'fighting', 'shooter'], default: 'wins' } },
    { name: 'tabGame', in: 'query', schema: { type: 'string', maxLength: 64 } },
  ],
  auth: 'public', cacheControl: 'public, s-maxage=60, stale-while-revalidate=300', response: rankingsResponseSchema,
  handler: async ({ req }) => {
    const q = parseQuery(req)
    const r = await getRankings(
      createAnonClient(), { gameSlug: q.game, region: q.region, page: q.page }, { mode: 'id', id: null },
    )
    const tab = tabContext(r.activeGames, q.metric, q.tabGame)
    const shown = rankPlayersBy(r.pagePlayers, q.metric, tab.honored?.id)
    return {
      scope: {
        game: r.activeGame?.slug ?? null, region: q.region,
        serverMetric: r.activeGame ? ('wins' as const) : ('score' as const),
        metric: q.metric, metricLabel: metricLabelFor(q.metric), tabGame: tab.honored?.slug ?? null,
      },
      tabs: metricTabsFor(r.activeGames), subGames: tab.subGames, subGamesAllLabel: tab.subGamesAllLabel,
      rows: shown.map((p) => mapRow(p, r, q.metric, tab.honored?.id, q.metric === 'wins')),
      page: { page: r.pageInfo.page, totalPages: r.pageInfo.totalPages, total: r.pageInfo.total, perPage: PAGE_SIZE },
      games: r.gamesWithMatches.map((g) => ({ id: g.id, slug: g.slug, name: g.name, category: g.category })),
      regions: r.regions,
      stats: {
        playersRanked: r.players.length, gamesIncluded: r.gamesWithMatches.length,
        totalMatches: r.matchCount ?? 0, prizesAwarded: r.prizesAwarded,
      },
      highlights: {
        topScore: r.highlights.topScore ? mapPlayerCard(r.highlights.topScore) : null,
        topTitles: r.highlights.topTitles ? mapPlayerCard(r.highlights.topTitles) : null,
        topWinRate: r.highlights.topWinRate ? mapPlayerCard(r.highlights.topWinRate) : null,
        topStreak: r.highlights.topStreak ? mapPlayerCard(r.highlights.topStreak) : null,
        topStreakValue: r.highlights.topStreakValue,
      },
    }
  },
})

export const rankingsMeEndpoint = defineEndpoint({
  operationId: 'getRankingsMe', method: 'GET', path: '/rankings/me',
  summary: 'Authenticated viewer global rank in the selected leaderboard scope and metric.',
  parameters: [
    { name: 'game', in: 'query', schema: { type: 'string', maxLength: 64 } },
    { name: 'region', in: 'query', schema: { type: 'string', maxLength: 64 } },
    { name: 'metric', in: 'query', schema: { type: 'string', enum: ['wins', 'score', 'football', 'fighting', 'shooter'], default: 'wins' } },
    { name: 'tabGame', in: 'query', schema: { type: 'string', maxLength: 64 } },
  ],
  auth: 'user', cacheControl: 'no-store', response: rankingsMeResponseSchema,
  handler: async ({ ctx, req }) => {
    const q = parseQuery(req)
    const r = await getRankings(
      createAnonClient(), { gameSlug: q.game, region: q.region, page: 1 }, { mode: 'id', id: ctx.userId },
    )
    if (!r.viewerRanked) return { row: null }
    const tab = tabContext(r.activeGames, q.metric, q.tabGame)
    return { row: mapRow(r.viewerRanked, r, q.metric, tab.honored?.id, false) }
  },
})

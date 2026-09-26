import { z } from 'zod'
import type { PlayerStatsInput, RankedPlayer } from '@/lib/rankings/leaderboard'
import type { Trend } from '@/lib/rankings/trend'

export const playerCardSchema = z.object({
  id: z.string(), username: z.string().nullable(), displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(), frameUrl: z.string().nullable(), country: z.string().nullable(),
  sxScore: z.number(), sentinelTier: z.string().nullable(), membershipTier: z.string(),
  kycVerified: z.boolean(), isDeleted: z.boolean(),
}).strict()
export type PlayerCard = z.infer<typeof playerCardSchema>

export function mapPlayerCard(p: PlayerStatsInput): PlayerCard {
  const isDeleted = p.deletedAt != null
  return {
    id: p.id,
    username: isDeleted ? null : p.username,
    displayName: isDeleted ? null : p.displayName,
    avatarUrl: isDeleted ? null : p.avatarUrl,
    frameUrl: isDeleted ? null : p.frameUrl ?? null,
    country: p.country,
    sxScore: p.sxScore,
    sentinelTier: p.sentinelTier,
    membershipTier: p.membershipTier,
    kycVerified: p.kycVerified,
    isDeleted,
  }
}

export const trendSchema = z.object({ direction: z.enum(['up', 'down', 'flat', 'new']), delta: z.number() }).strict()
export const winsByGameSchema = z.object({ gameId: z.string(), gameName: z.string(), wins: z.number().int() }).strict()

export const rankingRowSchema = z.object({
  rank: z.number().int(), player: playerCardSchema,
  wins: z.number(), losses: z.number(), totalMatches: z.number(), winRate: z.number(),
  goalsScored: z.number(), goalsConceded: z.number(), goalDiff: z.number(), totalTitles: z.number(),
  metricValue: z.number(), winsByGame: z.array(winsByGameSchema), trend: trendSchema, streak: z.number().int(),
}).strict()
export type RankingRow = z.infer<typeof rankingRowSchema>

export function mapRankingRow(
  p: RankedPlayer,
  extra: {
    trend: Trend; streak: number; metricValue: number; includeWinsByGame?: boolean;
    gameIdByName?: ReadonlyMap<string, string>;
  },
): RankingRow {
  return {
    rank: p.rank, player: mapPlayerCard(p), wins: p.wins, losses: p.losses,
    totalMatches: p.totalMatches, winRate: p.winRate, goalsScored: p.goalsScored,
    goalsConceded: p.goalsConceded, goalDiff: p.goalDiff, totalTitles: p.totalTitles,
    metricValue: extra.metricValue,
    winsByGame: extra.includeWinsByGame
      ? p.winsByGame.map((g) => ({ gameId: extra.gameIdByName?.get(g.game) ?? '', gameName: g.game, wins: g.wins }))
      : [],
    trend: { direction: extra.trend.direction, delta: extra.trend.delta }, streak: extra.streak,
  }
}

const metric = z.enum(['wins', 'score', 'football', 'fighting', 'shooter'])
const gameChip = z.object({ id: z.string(), slug: z.string(), name: z.string(), category: z.string() }).strict()
export const rankingsResponseSchema = z.object({
  scope: z.object({
    game: z.string().nullable(), region: z.string().nullable(), serverMetric: z.enum(['score', 'wins']),
    metric, metricLabel: z.string(), tabGame: z.string().nullable(),
  }).strict(),
  tabs: z.array(z.object({ key: metric, label: z.string() }).strict()),
  subGames: z.array(z.object({ slug: z.string(), name: z.string() }).strict()),
  subGamesAllLabel: z.string().nullable(), rows: z.array(rankingRowSchema),
  page: z.object({ page: z.number().int(), totalPages: z.number().int(), total: z.number().int(), perPage: z.number().int() }).strict(),
  games: z.array(gameChip), regions: z.array(z.string()),
  stats: z.object({ playersRanked: z.number().int(), gamesIncluded: z.number().int(), totalMatches: z.number().int(), prizesAwarded: z.number() }).strict(),
  highlights: z.object({
    topScore: playerCardSchema.nullable(), topTitles: playerCardSchema.nullable(),
    topWinRate: playerCardSchema.nullable(), topStreak: playerCardSchema.nullable(), topStreakValue: z.number().int(),
  }).strict(),
}).strict()
export const rankingsMeResponseSchema = z.object({ row: rankingRowSchema.nullable() }).strict()

export const seasonSummarySchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), startDate: z.string(), endDate: z.string(),
}).strict()
export const seasonListResponseSchema = z.object({ seasons: z.array(seasonSummarySchema) }).strict()
const seasonLeaderboardRow = z.object({
  playerId: z.string(), username: z.string().nullable(), displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(), sxScore: z.number(), points: z.number(), isProvisional: z.boolean(),
}).strict()
const seasonTournament = z.object({
  id: z.string(), title: z.string(), slug: z.string(), tournamentType: z.string(), status: z.string(),
  tournamentStart: z.string().nullable(), invitationOnly: z.boolean(),
}).strict()
export const seasonDetailResponseSchema = z.object({
  season: seasonSummarySchema,
  games: z.array(z.object({
    gameId: z.string(), gameName: z.string(), gameSlug: z.string(), tournaments: z.array(seasonTournament),
    leaderboard: z.array(seasonLeaderboardRow),
    tierLabels: z.object({
      communityClub: z.string(), masters: z.string(), qualificationNote: z.string(), showChampionsCupSpotlight: z.boolean(),
    }).strict(),
  }).strict()),
}).strict()

const placing = z.object({ id: z.string(), name: z.string() }).strict()
export const hallOfFameChampionSchema = z.object({
  tournamentId: z.string(), slug: z.string(), title: z.string(),
  tournamentType: z.enum(['champions_cup', 'masters', 'community_club', 'open']),
  gameId: z.string(), gameName: z.string(), date: z.string().nullable(), prizePool: z.number().nullable(),
  champion: placing, runnerUp: placing.nullable(), championAvatarUrl: z.string().nullable(), seasonName: z.string().nullable(),
}).strict()
const awardOption = z.object({
  gameId: z.string().nullable(), gameLabel: z.string(), winner: playerCardSchema.nullable(), metricValue: z.number(),
}).strict()
export const hallOfFameResponseSchema = z.object({
  games: z.array(gameChip), selectedGame: z.string().nullable(),
  awards: z.object({
    mvp: playerCardSchema.nullable(), goldenBoot: z.array(awardOption),
    categories: z.array(z.object({
      category: z.string(), label: z.string(), metricLabel: z.string(), options: z.array(awardOption),
    }).strict()),
  }).strict(),
  champions: z.object({
    championsCup: z.array(hallOfFameChampionSchema), masters: z.array(hallOfFameChampionSchema),
    communityClub: z.array(hallOfFameChampionSchema), open: z.array(hallOfFameChampionSchema),
  }).strict(),
  bronze: z.array(z.object({
    tournamentId: z.string(), slug: z.string(), title: z.string(), gameName: z.string().nullable(),
    date: z.string().nullable(), player: placing,
  }).strict()),
}).strict()

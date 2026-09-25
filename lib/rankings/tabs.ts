import { CATEGORY_META } from '@/lib/games/categories'
import { categoryStat, gameStat } from './game-breakdown'
import type { LeaderboardMetric, PlayerStatsInput } from './leaderboard'

export interface RankingTabGame { id: string; slug: string; name: string; category: string }

export function metricTabsFor(games: RankingTabGame[]): { key: LeaderboardMetric; label: string }[] {
  const categories = Array.from(new Set(games.map((g) => g.category)))
  return [
    { key: 'wins', label: 'Wins' },
    { key: 'score', label: 'SX Score' },
    ...categories
      .filter((category) => CATEGORY_META[category] != null)
      .map((category) => ({ key: category as LeaderboardMetric, label: CATEGORY_META[category].statLabel })),
  ]
}

export function metricValueFor(p: PlayerStatsInput, metric: LeaderboardMetric, gameId?: string): number {
  if (gameId && (metric === 'football' || metric === 'fighting' || metric === 'shooter')) {
    return gameStat(p.gameStats, gameId).scored
  }
  if (metric === 'wins') return p.wins
  if (metric === 'score') return p.sxScore
  return categoryStat(p.categoryStats, metric).scored
}

export function metricLabelFor(metric: LeaderboardMetric): string {
  if (metric === 'wins') return 'W'
  if (metric === 'score') return 'Score'
  return CATEGORY_META[metric]?.statLabel ?? metric
}

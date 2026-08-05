'use client'
import { useState } from 'react'
import { LeaderboardTable } from './LeaderboardTable'
import { rankPlayersBy, type PlayerStatsInput, type LeaderboardMetric } from '@/lib/rankings/leaderboard'
import { CATEGORY_META } from '@/lib/games/categories'

const BASE_TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'SX Score' },
]

export function LeaderboardTabs({
  players,
  currentUserId,
  activeCategories,
}: {
  players: PlayerStatsInput[]
  currentUserId: string | null
  activeCategories: string[]
}) {
  const categoryTabs = activeCategories
    .filter((c) => CATEGORY_META[c] != null)
    .map((c) => ({ key: c as LeaderboardMetric, label: CATEGORY_META[c].statLabel }))
  const tabs = [...BASE_TABS, ...categoryTabs]

  const [metric, setMetric] = useState<LeaderboardMetric>('wins')
  const ranked = rankPlayersBy(players, metric)
  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto scrollbar-hide rounded-xl border border-sx-border bg-sx-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setMetric(t.key)}
            className={`shrink-0 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              metric === t.key ? 'bg-sx-purple text-white' : 'text-sx-gray hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <LeaderboardTable players={ranked} currentUserId={currentUserId} metric={metric} />
    </div>
  )
}

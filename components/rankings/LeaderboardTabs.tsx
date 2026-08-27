'use client'
import { useState } from 'react'
import { LeaderboardTable } from './LeaderboardTable'
import { rankPlayersBy, type PlayerStatsInput, type LeaderboardMetric } from '@/lib/rankings/leaderboard'
import { CATEGORY_META } from '@/lib/games/categories'

const BASE_TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'SX Score' },
]

export interface ActiveGame {
  id: string
  name: string
  category: string
}

export function LeaderboardTabs({
  players,
  currentUserId,
  activeGames,
}: {
  players: PlayerStatsInput[]
  currentUserId: string | null
  activeGames: ActiveGame[]
}) {
  const activeCategories = Array.from(new Set(activeGames.map((g) => g.category)))
  const categoryTabs = activeCategories
    .filter((c) => CATEGORY_META[c] != null)
    .map((c) => ({ key: c as LeaderboardMetric, label: CATEGORY_META[c].statLabel }))
  const tabs = [...BASE_TABS, ...categoryTabs]

  const [metric, setMetric] = useState<LeaderboardMetric>('wins')
  // Games belonging to the currently selected category tab — a sub-filter
  // only makes sense (and only renders) when there are 2+ of them.
  const gamesForMetric = activeGames.filter((g) => g.category === metric)
  const [gameId, setGameId] = useState<string | null>(null)
  const ranked = rankPlayersBy(players, metric, gameId ?? undefined)

  function selectMetric(key: LeaderboardMetric) {
    setMetric(key)
    setGameId(null) // reset to "All" whenever the category changes
  }

  if (players.length === 0) return null

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto scrollbar-hide rounded-xl border border-sx-border bg-sx-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => selectMetric(t.key)}
            className={`shrink-0 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              metric === t.key ? 'bg-sx-purple text-white' : 'text-sx-gray hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {gamesForMetric.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setGameId(null)}
            className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
              gameId === null
                ? 'border-sx-purple bg-sx-purple/15 text-white'
                : 'border-sx-border text-sx-gray hover:text-white'
            }`}
          >
            All {CATEGORY_META[metric]?.statLabel ?? metric}
          </button>
          {gamesForMetric.map((g) => (
            <button
              key={g.id}
              onClick={() => setGameId(g.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                gameId === g.id
                  ? 'border-sx-purple bg-sx-purple/15 text-white'
                  : 'border-sx-border text-sx-gray hover:text-white'
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      <LeaderboardTable players={ranked} currentUserId={currentUserId} metric={metric} gameId={gameId} />
    </div>
  )
}

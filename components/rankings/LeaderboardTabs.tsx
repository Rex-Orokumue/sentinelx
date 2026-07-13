'use client'
import { useState } from 'react'
import { LeaderboardTable } from './LeaderboardTable'
import { rankPlayersBy, type PlayerStatsInput, type LeaderboardMetric } from '@/lib/rankings/leaderboard'

const TABS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'score', label: 'Sentinel Score' },
  { key: 'goals', label: 'Goals (Football)' },
]

export function LeaderboardTabs({
  players,
  currentUserId,
}: {
  players: PlayerStatsInput[]
  currentUserId: string | null
}) {
  const [metric, setMetric] = useState<LeaderboardMetric>('wins')
  const ranked = rankPlayersBy(players, metric)
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setMetric(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
              metric === t.key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
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

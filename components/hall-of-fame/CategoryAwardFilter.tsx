'use client'
import { useState } from 'react'
import { AllTimeAwardCard, AllTimeAwardEmptyCard } from './AllTimeAwardCard'
import type { PlayerStatsInput } from '@/lib/rankings/leaderboard'

export interface AwardOption {
  /** null = the category-wide "All X" option. */
  gameId: string | null
  gameLabel: string
  winner: PlayerStatsInput | null
  metricValue: number
}

export function CategoryAwardFilter({
  label,
  icon,
  metricLabel,
  awardName,
  options,
}: {
  label: string
  icon: string
  metricLabel: string
  awardName: string
  options: AwardOption[]
}) {
  const [gameId, setGameId] = useState<string | null>(null)
  const selected = options.find((o) => o.gameId === gameId) ?? options[0]

  return (
    <div className="flex-1">
      {options.length > 1 && (
        <div className="mb-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
          {options.map((o) => (
            <button
              key={o.gameId ?? 'all'}
              onClick={() => setGameId(o.gameId)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-colors ${
                selected.gameId === o.gameId
                  ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                  : 'border-sx-border text-sx-gray hover:text-white'
              }`}
            >
              {o.gameLabel}
            </button>
          ))}
        </div>
      )}
      {selected.winner ? (
        <AllTimeAwardCard
          label={label}
          icon={icon}
          avatarUrl={selected.winner.avatarUrl}
          name={selected.winner.displayName ?? selected.winner.username ?? 'Anonymous'}
          membershipTier={selected.winner.membershipTier}
          sentinelTier={selected.winner.sentinelTier}
          metricLabel={metricLabel}
          metricValue={selected.metricValue}
          awardName={awardName}
        />
      ) : (
        <AllTimeAwardEmptyCard label={label} icon={icon} />
      )}
    </div>
  )
}

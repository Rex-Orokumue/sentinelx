'use client'
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { TierBadge } from '@/components/player/TierBadge'
import type { RankedPlayer, LeaderboardMetric } from '@/lib/rankings/leaderboard'
import { categoryStat } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'

const METRIC_LABEL: Record<LeaderboardMetric, string> = {
  wins: 'W',
  score: 'Score',
  football: CATEGORY_META.football?.statLabel ?? 'Football',
  fighting: CATEGORY_META.fighting?.statLabel ?? 'Fighting',
  shooter: CATEGORY_META.shooter?.statLabel ?? 'Shooter',
}
const METRIC_VALUE: Record<LeaderboardMetric, (p: RankedPlayer) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sentinelScore,
  football: (p) => categoryStat(p.categoryStats, 'football').scored,
  fighting: (p) => categoryStat(p.categoryStats, 'fighting').scored,
  shooter: (p) => categoryStat(p.categoryStats, 'shooter').scored,
}

export function LeaderboardTable({
  players,
  currentUserId,
  metric,
}: {
  players: RankedPlayer[]
  currentUserId: string | null
  metric: LeaderboardMetric
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const metricValue = METRIC_VALUE[metric]
  const expandable = metric === 'wins'

  return (
    <div className="overflow-x-auto rounded-xl border border-sx-border bg-sx-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sx-border text-[11px] uppercase tracking-widest text-sx-gray">
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-2 py-3 text-left">Player</th>
            <th className="px-2 py-3 text-right">{METRIC_LABEL[metric]}</th>
            <th className="px-2 py-3 text-right">Win%</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Titles</th>
            <th className="hidden px-3 py-3 text-right sm:table-cell">GD</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl) => {
            // A logged-in user with 0 matches is excluded by the page query, so there
            // is simply no row here to highlight — expected, not a bug.
            const isMe = currentUserId != null && pl.id === currentUserId
            const name = pl.displayName ?? pl.username ?? 'Anonymous'
            const initial = (name[0] ?? '?').toUpperCase()
            const isExpanded = expandable && expandedId === pl.id
            return (
              <Fragment key={pl.id}>
                <tr
                  id={isMe ? 'my-rank-row' : undefined}
                  onClick={expandable ? () => setExpandedId(isExpanded ? null : pl.id) : undefined}
                  className={`scroll-mt-24 border-b border-sx-border/60 transition-colors last:border-0 ${
                    isMe ? 'border-l-2 border-l-sx-purple bg-sx-purple/10' : 'hover:bg-white/[0.03]'
                  } ${expandable ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-3 py-3.5 font-bold text-sx-gray">
                    {pl.rank === 1 ? '🥇' : pl.rank === 2 ? '🥈' : pl.rank === 3 ? '🥉' : `#${pl.rank}`}
                  </td>
                  <td className="px-2 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold leading-tight text-white">
                          {pl.username ? (
                            <Link
                              href={`/players/${pl.username}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-sx-purple-text"
                            >
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                          {isMe && <span className="ml-1 text-[11px] text-sx-purple-text">(you)</span>}
                          {expandable && (
                            <span className="ml-1.5 inline-block text-[10px] text-sx-gray">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          )}
                        </p>
                        <TierBadge tier={pl.sentinelTier} />
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3.5 text-right font-bold text-sx-purple-text">{metricValue(pl)}</td>
                  <td className="px-2 py-3.5 text-right text-white/80">{Math.round(pl.winRate * 100)}%</td>
                  <td className="hidden px-2 py-3.5 text-right text-sx-gray sm:table-cell">{pl.totalTitles}</td>
                  <td className="hidden px-3 py-3.5 text-right font-bold text-white sm:table-cell">
                    {pl.goalDiff > 0 ? `+${pl.goalDiff}` : pl.goalDiff}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-sx-border/60 bg-sx-bg/50 last:border-0">
                    <td colSpan={6} className="px-6 py-3 text-xs text-sx-gray">
                      {pl.winsByGame.length === 0
                        ? 'No wins recorded yet.'
                        : pl.winsByGame
                            .map((g) => `${g.game}: ${g.wins} win${g.wins === 1 ? '' : 's'}`)
                            .join(' · ')}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

'use client'
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { TierBadge } from '@/components/player/TierBadge'
import { MembershipBadge } from '@/components/player/MembershipBadge'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { BadgeCheck } from 'lucide-react'
import type { RankedPlayer, LeaderboardMetric } from '@/lib/rankings/leaderboard'
import type { Trend } from '@/lib/rankings/trend'
import { gameChipsFor } from '@/lib/rankings/game-chips'
import { GameChips } from './GameChips'
import { TrendCell } from './TrendCell'
import { categoryStat, gameStat } from '@/lib/rankings/game-breakdown'
import { CATEGORY_META } from '@/lib/games/categories'
import type { MembershipTier } from '@/lib/membership/tiers'

const METRIC_LABEL: Record<LeaderboardMetric, string> = {
  wins: 'W',
  score: 'Score',
  football: CATEGORY_META.football?.statLabel ?? 'Football',
  fighting: CATEGORY_META.fighting?.statLabel ?? 'Fighting',
  shooter: CATEGORY_META.shooter?.statLabel ?? 'Shooter',
}
const METRIC_VALUE: Record<LeaderboardMetric, (p: RankedPlayer) => number> = {
  wins: (p) => p.wins,
  score: (p) => p.sxScore,
  football: (p) => categoryStat(p.categoryStats, 'football').scored,
  fighting: (p) => categoryStat(p.categoryStats, 'fighting').scored,
  shooter: (p) => categoryStat(p.categoryStats, 'shooter').scored,
}
const CATEGORY_METRICS: LeaderboardMetric[] = ['football', 'fighting', 'shooter']

export function LeaderboardTable({
  players,
  trendByPlayer,
  pinnedViewer,
  currentUserId,
  metric,
  gameId,
}: {
  players: RankedPlayer[]
  /** Plain object, not a Map: this crosses the server/client boundary. */
  trendByPlayer?: Record<string, Trend>
  pinnedViewer?: RankedPlayer | null
  currentUserId: string | null
  metric: LeaderboardMetric
  gameId?: string | null
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Must mirror rankPlayersBy's own gameId-aware lead selection exactly —
  // otherwise sort order and the displayed number silently disagree (a
  // real bug caught in manual QA: filtering to a specific game correctly
  // re-sorted the table but kept showing everyone's category-wide total).
  const metricValue: (p: RankedPlayer) => number =
    gameId && CATEGORY_METRICS.includes(metric) ? (p) => gameStat(p.gameStats, gameId).scored : METRIC_VALUE[metric]
  const expandable = metric === 'wins'

  return (
    <div className="overflow-x-auto rounded-xl border border-sx-border bg-sx-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sx-border text-[11px] uppercase tracking-widest text-sx-gray">
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-2 py-3 text-left">Player</th>
            <th className="hidden px-2 py-3 text-right lg:table-cell">Games Played</th>
            <th className="px-2 py-3 text-right">{METRIC_LABEL[metric]}</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Total Wins</th>
            <th className="px-2 py-3 text-right">Win%</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Titles</th>
            <th className="hidden px-3 py-3 text-right lg:table-cell">Trend</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl) => {
            // A logged-in user with 0 matches is excluded by the page query, so there
            // is simply no row here to highlight — expected, not a bug.
            const isMe = currentUserId != null && pl.id === currentUserId
            const name = pl.displayName ?? pl.username ?? 'Anonymous'
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
                      <HexAvatar
                        src={pl.avatarUrl}
                        username={name}
                        tier={(pl.membershipTier ?? 'recruit') as MembershipTier}
                        size="xs"
                      />
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
                          {pl.kycVerified && (
                            <BadgeCheck
                              aria-label="Verified player"
                              className="ml-1 inline-block h-3.5 w-3.5 align-text-bottom text-sx-purple-text"
                            />
                          )}
                          {isMe && <span className="ml-1 text-[11px] text-sx-purple-text">(you)</span>}
                          {expandable && (
                            <span className="ml-1.5 inline-block text-[10px] text-sx-gray">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          )}
                        </p>
                        {pl.country && (
                          <p className="truncate text-[11px] leading-tight text-sx-gray">{pl.country}</p>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span title="SX Score reliability tier">
                            <TierBadge tier={pl.sentinelTier} />
                          </span>
                          <span title="XP membership level">
                            <MembershipBadge tier={pl.membershipTier} />
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-2 py-3.5 text-right lg:table-cell">
                    <GameChips data={gameChipsFor(pl.winsByGame)} />
                  </td>
                  <td className="px-2 py-3.5 text-right font-bold text-sx-purple-text">{metricValue(pl)}</td>
                  <td className="hidden px-2 py-3.5 text-right font-semibold text-white sm:table-cell">
                    {pl.wins}
                  </td>
                  <td className="px-2 py-3.5 text-right text-white/80">{Math.round(pl.winRate * 100)}%</td>
                  <td className="hidden px-2 py-3.5 text-right text-sx-gray sm:table-cell">{pl.totalTitles}</td>
                  <td className="hidden px-3 py-3.5 text-right lg:table-cell">
                    <TrendCell trend={trendByPlayer?.[pl.id]} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-sx-border/60 bg-sx-bg/50 last:border-0">
                    <td colSpan={8} className="px-6 py-3 text-xs text-sx-gray">
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

          {/* The viewer's own row when they're ranked but not on this page —
              the mockup's rank-63 row. Omitted when they're already visible
              above, so the table never shows the same player twice. */}
          {pinnedViewer && (
            <tr
              id="my-rank-row"
              className="scroll-mt-24 border-t-2 border-t-sx-purple/40 bg-sx-purple/10"
            >
              <td className="px-3 py-3.5 font-bold text-sx-purple-text">#{pinnedViewer.rank}</td>
              <td className="px-2 py-3.5">
                <div className="flex items-center gap-2.5">
                  <HexAvatar
                    src={pinnedViewer.avatarUrl}
                    username={pinnedViewer.displayName ?? pinnedViewer.username ?? 'You'}
                    tier={(pinnedViewer.membershipTier ?? 'recruit') as MembershipTier}
                    size="xs"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight text-white">
                      {pinnedViewer.displayName ?? pinnedViewer.username ?? 'You'}
                      <span className="ml-1 text-[11px] text-sx-purple-text">(you)</span>
                    </p>
                    {pinnedViewer.country && (
                      <p className="truncate text-[11px] leading-tight text-sx-gray">
                        {pinnedViewer.country}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="hidden px-2 py-3.5 text-right lg:table-cell">
                <GameChips data={gameChipsFor(pinnedViewer.winsByGame)} />
              </td>
              <td className="px-2 py-3.5 text-right font-bold text-sx-purple-text">
                {metricValue(pinnedViewer)}
              </td>
              <td className="hidden px-2 py-3.5 text-right font-semibold text-white sm:table-cell">
                {pinnedViewer.wins}
              </td>
              <td className="px-2 py-3.5 text-right text-white/80">
                {Math.round(pinnedViewer.winRate * 100)}%
              </td>
              <td className="hidden px-2 py-3.5 text-right text-sx-gray sm:table-cell">
                {pinnedViewer.totalTitles}
              </td>
              <td className="hidden px-3 py-3.5 text-right lg:table-cell">
                <TrendCell trend={trendByPlayer?.[pinnedViewer.id]} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

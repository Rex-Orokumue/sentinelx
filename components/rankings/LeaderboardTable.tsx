import { TierBadge } from '@/components/player/TierBadge'
import type { RankedPlayer } from '@/lib/rankings/leaderboard'

export function LeaderboardTable({
  players,
  currentUserId,
}: {
  players: RankedPlayer[]
  currentUserId: string | null
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-2 py-3 text-left">Player</th>
            <th className="px-2 py-3 text-right">W</th>
            <th className="px-2 py-3 text-right">Win%</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">Titles</th>
            <th className="hidden px-2 py-3 text-right sm:table-cell">GD</th>
            <th className="hidden px-3 py-3 text-right sm:table-cell">Score</th>
          </tr>
        </thead>
        <tbody>
          {players.map((pl) => {
            // A logged-in user with 0 matches is excluded by the page query, so there
            // is simply no row here to highlight — expected, not a bug.
            const isMe = currentUserId != null && pl.id === currentUserId
            const name = pl.displayName ?? pl.username ?? 'Anonymous'
            const initial = (name[0] ?? '?').toUpperCase()
            return (
              <tr
                key={pl.id}
                className={`border-b border-slate-800/50 transition-colors last:border-0 ${
                  isMe ? 'bg-violet-500/10' : 'hover:bg-slate-800/40'
                }`}
              >
                <td className="px-3 py-3.5 font-bold text-slate-400">
                  {pl.rank === 1 ? '🥇' : pl.rank === 2 ? '🥈' : pl.rank === 3 ? '🥉' : `#${pl.rank}`}
                </td>
                <td className="px-2 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold leading-tight text-white">
                        {name}
                        {isMe && <span className="ml-1 text-[11px] text-violet-400">(you)</span>}
                      </p>
                      <TierBadge tier={pl.sentinelTier} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3.5 text-right font-bold text-emerald-400">{pl.wins}</td>
                <td className="px-2 py-3.5 text-right text-slate-300">{Math.round(pl.winRate * 100)}%</td>
                <td className="hidden px-2 py-3.5 text-right text-slate-400 sm:table-cell">{pl.totalTitles}</td>
                <td className="hidden px-2 py-3.5 text-right text-slate-400 sm:table-cell">
                  {pl.goalDiff > 0 ? `+${pl.goalDiff}` : pl.goalDiff}
                </td>
                <td className="hidden px-3 py-3.5 text-right font-bold text-white sm:table-cell">
                  {pl.sentinelScore}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

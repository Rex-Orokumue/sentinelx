import Link from 'next/link'
import type { BracketMatch } from '@/lib/tournaments/bracket'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  live:      { label: 'LIVE',      cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  scheduled: { label: 'UPCOMING',  cls: 'bg-slate-600/30 text-slate-300 border-slate-600/40' },
  completed: { label: 'FT',        cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  disputed:  { label: 'DISPUTED',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  cancelled: { label: 'CANCELLED', cls: 'bg-slate-700/40 text-slate-500 border-slate-700/50' },
}

export function MatchCard({ match, showGroup = false }: { match: BracketMatch; showGroup?: boolean }) {
  const badge = STATUS_BADGE[match.status] ?? STATUS_BADGE.scheduled
  const hasScore = match.score_a != null && match.score_b != null
  const aWon = hasScore && match.score_a! > match.score_b!
  const bWon = hasScore && match.score_b! > match.score_a!

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-xl border border-slate-800 bg-slate-900 p-3 transition-colors hover:border-violet-500/40"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
          {match.status === 'live' && (
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          )}
          {badge.label}
        </span>
        {showGroup && match.groupName && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {match.groupName}
          </span>
        )}
      </div>
      <PlayerRow name={match.playerA.name} score={match.score_a} win={aWon} />
      <PlayerRow name={match.playerB.name} score={match.score_b} win={bWon} />
    </Link>
  )
}

function PlayerRow({ name, score, win }: { name: string; score: number | null; win: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`truncate text-sm ${win ? 'font-bold text-white' : 'text-slate-300'}`}>{name}</span>
      <span className={`ml-2 shrink-0 text-sm tabular-nums ${win ? 'font-bold text-white' : 'text-slate-400'}`}>
        {score ?? '–'}
      </span>
    </div>
  )
}

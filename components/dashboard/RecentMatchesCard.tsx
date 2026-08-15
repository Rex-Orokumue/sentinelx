import Link from 'next/link'
import { formatDate } from '@/lib/format'
import type { RecentMatchRow } from '@/lib/dashboard/recent-matches'

const RESULT_PILL: Record<RecentMatchRow['outcome'], string> = {
  win: 'bg-emerald-500/15 text-emerald-400',
  loss: 'bg-red-500/15 text-red-400',
  draw: 'bg-slate-500/15 text-slate-300',
}

export function RecentMatchesCard({ matches, username }: { matches: RecentMatchRow[]; username: string | null }) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Recent Matches</h2>
        {username && (
          <Link href={`/players/${username}#match-history`} className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
            View All →
          </Link>
        )}
      </div>
      {matches.length === 0 ? (
        <p className="text-sm text-sx-gray">Your match history will appear here after your first game.</p>
      ) : (
        <div className="divide-y divide-sx-border">
          {matches.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] font-bold uppercase ${RESULT_PILL[m.outcome]}`}>
                {m.outcome}
              </span>
              <p className="min-w-0 flex-1 truncate text-white">
                vs{' '}
                {m.opponentUsername ? (
                  <Link href={`/players/${m.opponentUsername}`} className="hover:text-sx-purple-text">
                    {m.opponentName}
                  </Link>
                ) : (
                  m.opponentName
                )}
              </p>
              <p className="shrink-0 font-bold text-white">
                {m.myScore}–{m.opponentScore}
              </p>
              <p className="hidden shrink-0 truncate text-xs text-sx-gray sm:block">{m.tournamentTitle}</p>
              <p className="shrink-0 text-xs text-sx-gray">{formatDate(m.updatedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

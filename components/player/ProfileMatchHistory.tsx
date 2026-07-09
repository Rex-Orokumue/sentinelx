import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/format'
import type { ProfileMatch } from '@/lib/players/profile'

const OUTCOME: Record<string, { label: string; cls: string }> = {
  win: { label: 'W', cls: 'bg-emerald-500/20 text-emerald-400' },
  loss: { label: 'L', cls: 'bg-red-500/20 text-red-400' },
  draw: { label: 'D', cls: 'bg-slate-600/40 text-slate-300' },
}

export function ProfileMatchHistory({ matches }: { matches: ProfileMatch[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-bold text-white">Recent matches</h2>
      {matches.length === 0 ? (
        <EmptyState icon="🎮" title="No matches yet" body="Completed matches will show up here." />
      ) : (
        <div className="space-y-2">
          {matches.map((m) => {
            const o = OUTCOME[m.outcome]
            const when = formatDate(m.completedAt)
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${o.cls}`}>
                    {o.label}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">vs {m.opponentName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {m.tournamentTitle ?? 'Match'}{when ? ` · ${when}` : ''}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-bold tabular-nums text-white">
                  {m.playerScore}–{m.opponentScore}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

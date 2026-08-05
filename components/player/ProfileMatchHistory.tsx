import Link from 'next/link'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/format'
import type { ProfileMatch } from '@/lib/players/profile'

const OUTCOME: Record<string, { label: string; cls: string }> = {
  win: { label: 'W', cls: 'bg-sx-green/15 text-sx-green' },
  loss: { label: 'L', cls: 'bg-red-500/15 text-red-400' },
  draw: { label: 'D', cls: 'bg-white/10 text-white/70' },
}

export function ProfileMatchHistory({
  matches,
  username,
}: {
  matches: ProfileMatch[]
  // Carried into the match link so the Match Centre's back link returns here
  // rather than to a tournament page the visitor was never on.
  username: string
}) {
  return (
    <section id="match-history" className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Recent Matches</h2>
      </div>
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
                href={`/matches/${m.id}?from=profile&u=${encodeURIComponent(username)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-sx-border bg-sx-surface p-4 transition-colors hover:border-sx-purple/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${o.cls}`}>
                    {o.label}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">vs {m.opponentName}</p>
                    <p className="truncate text-xs text-sx-gray">
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

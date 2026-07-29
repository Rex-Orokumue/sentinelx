import Link from 'next/link'
import { completedMatchBadge } from '@/lib/matches/completed-match-badge'
import type { CompletedMatchDateGroup, CompletedMatchRow } from '@/lib/matches/completed-matches'

const ROUND_LABELS: Record<string, string> = {
  group: 'Group',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter_final: 'Quarter-final',
  semi_final: 'Semi-final',
  final: 'Final',
}

export function CompletedMatchesList({
  groups,
  reviewHrefFor,
}: {
  groups: CompletedMatchDateGroup[]
  // Admin pages pass this to link each row to its review/correction page.
  // Omit on public pages — players don't get an edit link.
  reviewHrefFor?: (matchId: string) => string
}) {
  if (groups.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
        No matches have been played yet.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.dateKey || 'tbd'}>
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            {g.dateLabel} ({g.matches.length})
          </h3>
          <div className="space-y-2">
            {g.matches.map((m) => (
              <MatchRow key={m.id} match={m} href={reviewHrefFor?.(m.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MatchRow({ match: m, href }: { match: CompletedMatchRow; href?: string }) {
  const badge = completedMatchBadge(m.status, m.resolution)
  const winnerA = m.scoreA != null && m.scoreB != null && m.scoreA > m.scoreB
  const winnerB = m.scoreA != null && m.scoreB != null && m.scoreB > m.scoreA
  const body = (
    <div
      className={`rounded-2xl border p-4 ${
        href ? 'border-slate-800 bg-slate-900 transition-colors hover:border-slate-600' : 'border-slate-800 bg-slate-900'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm">
          <span className={winnerA ? 'font-bold text-white' : 'text-slate-300'}>{m.playerAName}</span>
          <span className="mx-2 font-black text-slate-500">
            {m.scoreA ?? '–'} – {m.scoreB ?? '–'}
          </span>
          <span className={winnerB ? 'font-bold text-white' : 'text-slate-300'}>{m.playerBName}</span>
        </p>
        {badge && (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {ROUND_LABELS[m.round] ?? m.round}
        {m.groupName ? ` · ${m.groupName}` : ''}
      </p>
    </div>
  )
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  )
}

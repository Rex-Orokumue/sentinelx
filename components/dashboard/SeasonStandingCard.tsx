import { seasonQualifyProgress } from '@/lib/dashboard/command-centre'

// Rank threshold for a Masters invitation — presentational copy only; the
// actual invite slot count is computed server-side by lib/seasons/eligibility.ts
// (openSlots is admin/tournament-driven). "Top 16" mirrors the spec's own copy.
const MASTERS_QUALIFY_RANK = 16

export function SeasonStandingCard({
  seasonRank,
  seasonPoints,
  pointsAtRankSixteen,
  monthlyRank,
  monthlyPoints,
}: {
  seasonRank: number | null
  seasonPoints: number
  pointsAtRankSixteen: number
  monthlyRank: number | null
  monthlyPoints: number
}) {
  const { qualified, pointsNeeded } = seasonQualifyProgress(seasonRank, seasonPoints, pointsAtRankSixteen)
  const pct = qualified ? 100 : Math.min(100, pointsAtRankSixteen > 0 ? Math.round((seasonPoints / pointsAtRankSixteen) * 100) : 0)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">📅 Season 1 Standing</h2>
      <div className="mt-3 flex items-baseline justify-between border-t border-sx-border pt-3">
        <p className="text-white">
          <span className="font-display text-xl font-black">{seasonRank != null ? `#${seasonRank}` : 'Unranked'}</span>{' '}
          Season Rank
        </p>
        <p className="text-sm text-sx-gray">{seasonPoints.toLocaleString()} pts</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all ${qualified ? 'bg-amber-500' : 'bg-sx-purple'}`} style={{ width: `${pct}%` }} />
      </div>
      {qualified ? (
        <p className="mt-1.5 text-xs font-semibold text-amber-400">✅ You&apos;re in the top {MASTERS_QUALIFY_RANK} — Masters invitation coming.</p>
      ) : (
        <p className="mt-1.5 text-xs text-sx-gray">
          Top {MASTERS_QUALIFY_RANK} = Masters invite · You need {pointsNeeded.toLocaleString()} more points to qualify
        </p>
      )}

      <div className="mt-4 border-t border-sx-border pt-3 text-sm text-sx-gray">
        This month: <span className="font-bold text-white">{monthlyRank != null ? `#${monthlyRank}` : 'Unranked'}</span> ·{' '}
        {monthlyPoints.toLocaleString()} pts
        <p className="mt-0.5 text-xs">Top {MASTERS_QUALIFY_RANK} this month = Masters invite</p>
      </div>
    </section>
  )
}

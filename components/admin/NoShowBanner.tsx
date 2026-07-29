import Link from 'next/link'

export interface FlaggedMatchRow {
  id: string
  playerAName: string
  playerBName: string
  round: string
}

export function NoShowBanner({ matches }: { matches: FlaggedMatchRow[] }) {
  if (matches.length === 0) return null
  return (
    <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="mb-2 text-sm font-bold text-amber-300">
        {matches.length} match{matches.length === 1 ? '' : 'es'} past deadline need a decision
      </p>
      <div className="space-y-1.5">
        {matches.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className="block text-xs text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100"
          >
            {m.playerAName} vs {m.playerBName} — {m.round.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>
    </div>
  )
}

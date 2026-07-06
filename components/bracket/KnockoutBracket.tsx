import type { BracketMatch } from '@/lib/tournaments/bracket'
import { MatchCard } from './MatchCard'

export function KnockoutBracket({
  rounds,
}: {
  rounds: { round: string; label: string; matches: BracketMatch[] }[]
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Knockout</h2>
      <div className="space-y-6">
        {rounds.map((r) => (
          <div key={r.round}>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">{r.label}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {r.matches.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

import type { DedupableGame } from '@/lib/games/dedupe'

export function TrustedByStrip({ games }: { games: DedupableGame[] }) {
  if (games.length === 0) return null
  return (
    <section className="mb-10 text-center">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-violet-400/80">
        Trusted by Gamers
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {games.map((g) => (
          <span
            key={g.name}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
              g.active ? 'border-slate-700 text-slate-300' : 'border-slate-800 text-slate-600'
            }`}
          >
            {g.name}
            {!g.active && (
              <span className="ml-1.5 text-[10px] normal-case text-slate-600">(Coming soon)</span>
            )}
          </span>
        ))}
      </div>
    </section>
  )
}

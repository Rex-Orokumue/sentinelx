import type { DedupableGame } from '@/lib/games/dedupe'

export function TrustedByStrip({ games }: { games: DedupableGame[] }) {
  if (games.length === 0) return null
  return (
    <section className="mb-10 -mx-4 border-y border-sx-border bg-sx-surface/50 px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 sm:flex-row">
        <p className="shrink-0 text-xs font-bold uppercase tracking-widest text-sx-purple-text">
          Trusted by Gamers
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          {games.map((g) => (
            <span
              key={g.name}
              className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
                g.active ? 'border-sx-border text-white' : 'border-sx-border/60 text-sx-gray'
              }`}
            >
              {g.name}
              {!g.active && <span className="ml-1.5 text-[10px] normal-case text-sx-gray/70">(Coming soon)</span>}
            </span>
          ))}
          <span className="rounded-full border border-sx-border px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-sx-gray">
            &amp; More
          </span>
        </div>
      </div>
    </section>
  )
}

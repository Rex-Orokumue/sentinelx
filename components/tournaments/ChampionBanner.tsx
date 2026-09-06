import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import type { ChampionEntry } from '@/lib/tournaments/champions'

// Leads a completed tournament page with its result, so a visitor learns who
// won without reading a finished bracket. Rendered only when the champion is
// actually decided — an undecided tournament keeps the plain presentation
// rather than showing a blank trophy.
export function ChampionBanner({ entry }: { entry: ChampionEntry }) {
  return (
    <section className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-sx-amber/20 bg-gradient-to-br from-sx-amber/[0.07] to-sx-surface p-6">
      <span className="text-4xl leading-none sm:text-5xl">🏆</span>

      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-sx-amber">
          Champion{entry.gameName ? ` · ${entry.gameName}` : ''}
        </p>
        <p className="truncate font-display text-2xl font-black uppercase leading-none text-white">
          {entry.champion.name}
        </p>
        {entry.runnerUp && (
          <p className="mt-1.5 truncate text-sm text-sx-gray">
            🥈 Runner-up: <span className="text-white">{entry.runnerUp.name}</span>
          </p>
        )}
        {entry.prizePool != null && entry.prizePool > 0 && (
          <p className="mt-1 text-sm text-sx-gray">{formatNaira(entry.prizePool)} prize pool</p>
        )}
      </div>

      <Link
        href="/hall-of-fame"
        className="ml-auto shrink-0 self-end text-sm font-semibold text-sx-amber transition-colors hover:text-amber-300"
      >
        Hall of Fame →
      </Link>
    </section>
  )
}

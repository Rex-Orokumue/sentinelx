import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import type { HallOfFameTeaserData } from '@/lib/home/hall-of-fame-teaser'

export function HallOfFameTeaser({ data }: { data: HallOfFameTeaserData | null }) {
  if (!data) return null

  return (
    <section className="mb-10">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Hall of Fame</p>
      <h2 className="mb-4 font-display text-2xl font-black uppercase text-white">Champions Cup</h2>
      <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-sx-amber/20 bg-gradient-to-br from-sx-amber/[0.07] to-sx-surface p-7">
        <span className="text-5xl leading-none">🏆</span>
        <div className="flex-1">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-sx-amber">
            Champions Cup Winner{data.gameName ? ` · ${data.gameName}` : ''}
          </p>
          <p className="font-display text-2xl font-black uppercase leading-none text-white">
            {data.championName}
          </p>
          <p className="mt-1.5 text-sm text-sx-gray">
            {data.title} · {formatNaira(data.prizePool)} won
          </p>
        </div>
        <Link
          href="/hall-of-fame"
          className="ml-auto shrink-0 self-end text-sm font-semibold text-sx-amber transition-colors hover:text-amber-300"
        >
          View Hall of Fame →
        </Link>
      </div>
    </section>
  )
}

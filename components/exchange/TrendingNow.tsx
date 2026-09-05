import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatNaira } from '@/lib/format'
import { resolveSpecLine } from '@/lib/exchange/subtitle'
import type { ListingCardData } from './ListingCard'

export function TrendingNow({ listings }: { listings: ListingCardData[] }) {
  // An empty "Trending" panel is worse than no panel at all.
  if (listings.length === 0) return null

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-black uppercase tracking-wider text-white">Trending Now</h2>
        <Link
          href="/exchange"
          className="ml-auto flex items-center gap-1 text-[11px] font-bold text-sx-purple-text hover:text-sx-purple-light"
        >
          View All
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <ul className="mt-4 space-y-3">
        {listings.map((l) => (
          <li key={l.id}>
            <Link href={`/exchange/${l.id}`} className="group flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-sx-bg">
                {l.primaryImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.primaryImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm text-sx-border">🎮</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-white group-hover:text-sx-purple-text">
                  {l.title}
                </span>
                <span className="block truncate text-[10px] text-sx-gray">
                  {resolveSpecLine({
                    subtitle: l.subtitle,
                    description: l.description,
                    gameName: l.gameName,
                    category: l.category,
                  })}
                </span>
                <span className="block text-[11px] font-black text-sx-purple-text">
                  {formatNaira(l.price)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

import Link from 'next/link'
import { formatMonthYear } from '@/lib/format'

export function BronzeCard({
  playerName,
  slug,
  title,
  gameName,
  date,
}: {
  playerName: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
}) {
  const initial = (playerName[0] ?? '?').toUpperCase()
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-sx-border bg-sx-surface p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-700/20 text-lg">🥉</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">
            {initial}
          </div>
          <p className="truncate font-bold text-white">{playerName}</p>
        </div>
        <Link href={`/tournaments/${slug}`} className="mt-1 block truncate text-sm text-sx-purple-text hover:text-sx-purple-light">
          {title}
        </Link>
        <p className="mt-0.5 text-xs text-sx-gray">
          {gameName ?? 'Third Place'}
          {formatMonthYear(date) ? ` · ${formatMonthYear(date)}` : ''}
        </p>
      </div>
    </div>
  )
}

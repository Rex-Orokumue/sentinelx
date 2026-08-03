import Link from 'next/link'
import { formatMonthYear } from '@/lib/format'

export function PlacementCard({
  icon,
  playerName,
  slug,
  title,
  gameName,
  date,
  fallbackLabel,
}: {
  icon: string
  playerName: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  fallbackLabel: string
}) {
  const initial = (playerName[0] ?? '?').toUpperCase()
  const formattedDate = formatMonthYear(date)
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-lg">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">
            {initial}
          </div>
          <p className="truncate font-black text-white">{playerName}</p>
        </div>
        <Link
          href={`/tournaments/${slug}`}
          className="mt-1 block truncate text-sm text-violet-400 hover:text-violet-300"
        >
          {title}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {gameName ?? fallbackLabel}
          {formattedDate ? ` · ${formattedDate}` : ''}
        </p>
      </div>
    </div>
  )
}

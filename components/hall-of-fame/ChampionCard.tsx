import Link from 'next/link'
import type { ChampionEntry } from '@/lib/hall-of-fame/awards'
import { formatMonthYear } from '@/lib/format'

export function ChampionCard({ entry }: { entry: ChampionEntry }) {
  const initial = (entry.champion.name[0] ?? '?').toUpperCase()
  const date = formatMonthYear(entry.date)
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-lg">
        🏆
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-white">
            {initial}
          </div>
          <p className="truncate font-black text-white">{entry.champion.name}</p>
        </div>
        <Link
          href={`/tournaments/${entry.slug}`}
          className="mt-1 block truncate text-sm text-violet-400 hover:text-violet-300"
        >
          {entry.title}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {entry.gameName ?? 'Champion'}
          {date ? ` · ${date}` : ''}
        </p>
      </div>
    </div>
  )
}

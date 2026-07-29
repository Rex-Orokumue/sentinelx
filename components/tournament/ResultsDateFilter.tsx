import Link from 'next/link'
import type { CompletedMatchDateGroup } from '@/lib/matches/completed-matches'

export function ResultsDateFilter({
  groups,
  activeDate,
  basePath,
}: {
  groups: CompletedMatchDateGroup[]
  activeDate?: string
  basePath: string
}) {
  if (groups.length <= 1) return null
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <Chip href={basePath} active={!activeDate}>
        All dates
      </Chip>
      {groups.map((g) => (
        <Chip key={g.dateKey || 'tbd'} href={`${basePath}?date=${g.dateKey}`} active={activeDate === g.dateKey}>
          {g.dateLabel}
        </Chip>
      ))}
    </div>
  )
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? 'border-violet-500 bg-violet-500/10 text-violet-300'
          : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
      }`}
    >
      {children}
    </Link>
  )
}

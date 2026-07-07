export function DashboardHeader({
  name,
  wins,
  losses,
  goalsScored,
}: {
  name: string
  wins: number
  losses: number
  goalsScored: number
}) {
  const initial = (name[0] ?? '?').toUpperCase()
  return (
    <div className="flex items-center gap-4 py-8">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xl font-bold text-white">
        {initial}
      </div>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-bold text-emerald-400">{wins}</span> W ·{' '}
          <span className="font-bold text-red-400">{losses}</span> L ·{' '}
          <span className="font-bold text-white">{goalsScored}</span> goals
        </p>
      </div>
    </div>
  )
}

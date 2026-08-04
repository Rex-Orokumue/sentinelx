function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function SeasonHero({
  season,
  tournaments,
  playersCompeting,
}: {
  season: { name: string; start_date: string; end_date: string }
  tournaments: { tournament_type: string; status: string }[]
  playersCompeting: number
}) {
  const clubsCompleted = tournaments.filter((t) => t.tournament_type === 'community_club' && t.status === 'completed').length
  const mastersCompleted = tournaments.filter((t) => t.tournament_type === 'masters' && t.status === 'completed').length

  return (
    <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <p className="text-xs font-bold uppercase tracking-wider text-violet-400">{season.name}</p>
      <h1 className="mt-1 text-2xl font-bold text-white">
        {formatMonthYear(season.start_date)} – {formatMonthYear(season.end_date)}
      </h1>
      <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-400">
        <span className="rounded-full border border-slate-700 px-3 py-1">{clubsCompleted} Community Clubs completed</span>
        <span className="rounded-full border border-slate-700 px-3 py-1">{mastersCompleted} Masters completed</span>
        <span className="rounded-full border border-slate-700 px-3 py-1">{playersCompeting} players competing</span>
      </div>
    </div>
  )
}

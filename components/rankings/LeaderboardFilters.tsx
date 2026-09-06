import Link from 'next/link'

export interface FilterSeason {
  id: string
  name: string
}

// A plain GET form: server-rendered, URL-driven, no client state. The active
// game rides along in a hidden field so applying a filter doesn't drop the tab,
// and `page` is deliberately absent so a filter change returns to page one
// rather than a page that may no longer exist.
//
// The mockup's third "All Games" select is omitted — the tab row above already
// does exactly that, and two controls for one thing is a trap.
export function LeaderboardFilters({
  regions,
  seasons,
  activeGame,
  activeRegion,
  activeSeason,
}: {
  regions: string[]
  seasons: FilterSeason[]
  activeGame: string | null
  activeRegion: string | null
  activeSeason: string | null
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">Filters</p>
        <Link href="/rankings" className="text-[11px] font-semibold text-sx-gray hover:text-white">
          Reset
        </Link>
      </div>

      <form method="get" className="space-y-3">
        {activeGame && <input type="hidden" name="game" value={activeGame} />}

        <label className="block">
          <span className="sr-only">Region</span>
          <select
            name="region"
            defaultValue={activeRegion ?? ''}
            className="w-full rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-xs text-white focus:border-sx-purple focus:outline-none"
          >
            <option value="">All Regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Season</span>
          <select
            name="season"
            defaultValue={activeSeason ?? ''}
            className="w-full rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-xs text-white focus:border-sx-purple focus:outline-none"
          >
            <option value="">All Seasons</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
        >
          Apply Filters
        </button>
      </form>
    </div>
  )
}

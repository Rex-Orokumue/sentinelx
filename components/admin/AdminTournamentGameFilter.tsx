'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Auto-navigating game filter for the admin tournament list — sets/clears the
// `game` query param (a game slug) while preserving the `status` filter.
export function AdminTournamentGameFilter({
  games,
  value,
}: {
  games: { name: string; slug: string }[]
  value: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function onChange(next: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (next) sp.set('game', next)
    else sp.delete('game')
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white focus:border-violet-500 focus:outline-none"
      aria-label="Filter tournaments by game"
    >
      <option value="">All games</option>
      {games.map((g) => (
        <option key={g.slug} value={g.slug}>
          {g.name}
        </option>
      ))}
    </select>
  )
}

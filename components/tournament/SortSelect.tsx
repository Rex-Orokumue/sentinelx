'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Auto-navigating sort dropdown — changes the `sort` query param in place while
// preserving every other filter (tab, q, game, page resets to 1 since the
// result set order changed).
export function SortSelect({ value }: { value: 'latest' | 'prize' }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function onChange(next: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (next === 'latest') sp.delete('sort')
    else sp.set('sort', next)
    sp.delete('page')
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-sx-border bg-sx-surface px-3 py-1.5 text-xs font-bold text-white focus:border-sx-purple/50 focus:outline-none"
    >
      <option value="latest">Sort by: Latest</option>
      <option value="prize">Sort by: Prize Pool</option>
    </select>
  )
}

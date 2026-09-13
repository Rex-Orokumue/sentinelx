'use client'

export type FeedFilter = 'all' | 'following' | 'results' | 'announcements' | 'achievements'

const BASE_TABS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'results', label: 'Results' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'achievements', label: 'Achievements' },
]

// Client-side filter over already-loaded posts — no refetch (spec §4). The
// Following tab follows the same rule as the rest: it filters the current
// page, it does not fetch a fresh one — matching the existing limitation of
// Results/Announcements/Achievements (none of them page past what's loaded
// either).
export function FeedFilters({
  active,
  onChange,
  showFollowing,
}: {
  active: FeedFilter
  onChange: (f: FeedFilter) => void
  showFollowing: boolean
}) {
  const tabs = showFollowing
    ? [BASE_TABS[0], { key: 'following' as const, label: 'Following' }, ...BASE_TABS.slice(1)]
    : BASE_TABS
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
            active === t.key ? 'border-sx-purple/40 bg-sx-purple/20 text-sx-purple-text' : 'border-sx-border bg-sx-surface text-sx-gray hover:border-sx-gray'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

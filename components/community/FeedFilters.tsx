'use client'

export type FeedFilter = 'all' | 'results' | 'announcements' | 'achievements'

const TABS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'results', label: 'Results' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'achievements', label: 'Achievements' },
]

// Client-side filter over already-loaded posts — no refetch (spec §4).
export function FeedFilters({ active, onChange }: { active: FeedFilter; onChange: (f: FeedFilter) => void }) {
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {TABS.map((t) => (
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

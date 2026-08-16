import Link from 'next/link'

// "Find Teammates" (mockup) → relabeled "Find Friends" and points at the
// real /dashboard/friends flow — that destination is the player's existing
// circle, not a stranger-discovery tool, so the label is changed to match
// what it actually does rather than routing to a coming-soon page (spec
// review decision, 2026-08-16). "Create Team" has no backing feature (teams
// are a v4 roadmap item) and goes to /coming-soon.
const TILES = [
  { label: 'Find Friends', icon: '🤝', href: '/dashboard/friends' },
  { label: 'Create Team', icon: '👥', href: '/coming-soon?feature=Teams' },
  { label: 'Join Discussions', icon: '💬', href: '#feed' },
  { label: 'Share Content', icon: '📤', href: '#new-post-launcher' },
  { label: 'Get Help', icon: '❓', href: '/coming-soon?feature=Help+Center' },
]

export function QuickActionTiles() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {TILES.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="flex flex-col items-center gap-1.5 rounded-xl border border-sx-border bg-sx-surface px-3 py-4 text-center transition-colors hover:border-sx-purple/40 hover:bg-sx-purple/10"
        >
          <span className="text-xl">{t.icon}</span>
          <span className="text-xs font-semibold text-white">{t.label}</span>
        </Link>
      ))}
    </div>
  )
}

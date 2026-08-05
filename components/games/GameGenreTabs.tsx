import Link from 'next/link'

// Plain server-rendered tab links — no client state needed, `genre` drives
// filtering entirely from the URL (see app/(public)/games/page.tsx).
export function GameGenreTabs({
  genres,
  active,
}: {
  genres: { key: string; label: string }[]
  active: string
}) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
      {genres.map((g) => (
        <Link
          key={g.key}
          href={g.key === 'all' ? '/games' : `/games?genre=${g.key}`}
          className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
            active === g.key
              ? 'bg-sx-purple/15 text-white'
              : 'text-sx-gray hover:text-white'
          }`}
        >
          {g.label}
        </Link>
      ))}
    </div>
  )
}

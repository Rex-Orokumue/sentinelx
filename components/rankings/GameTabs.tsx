import Link from 'next/link'

export interface TabGame {
  id: string
  name: string
  slug: string
}

const VISIBLE_TABS = 6

// Server-rendered, URL-driven game scoping (?game=<slug>) so a filtered board is
// a shareable, paginable link. The metric toggle and the wins expander stay
// client-side inside LeaderboardTabs — the two never share state.
//
// Only games with at least one completed match are passed in, so no tab ever
// opens an empty board. Beyond six, the rest collapse into a native <details>
// dropdown rather than a client component.
export function GameTabs({
  games,
  activeSlug,
}: {
  games: TabGame[]
  activeSlug: string | null
}) {
  const visible = games.slice(0, VISIBLE_TABS)
  const overflow = games.slice(VISIBLE_TABS)

  return (
    <nav aria-label="Filter by game" className="mb-4 flex flex-wrap items-center gap-2">
      <Tab href="/rankings" label="All Games" active={!activeSlug} />
      {visible.map((g) => (
        <Tab
          key={g.id}
          href={`/rankings?game=${g.slug}`}
          label={g.name}
          active={activeSlug === g.slug}
        />
      ))}

      {overflow.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full border border-sx-border px-3 py-1.5 text-xs font-semibold text-sx-gray hover:text-white">
            More
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-40 rounded-xl border border-sx-border bg-sx-surface p-1 shadow-lg">
            {overflow.map((g) => (
              <Link
                key={g.id}
                href={`/rankings?game=${g.slug}`}
                className={`block truncate rounded-lg px-3 py-2 text-xs font-semibold ${
                  activeSlug === g.slug ? 'text-sx-purple-text' : 'text-sx-gray hover:text-white'
                }`}
              >
                {g.name}
              </Link>
            ))}
          </div>
        </details>
      )}
    </nav>
  )
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-sx-purple bg-sx-purple/20 text-sx-purple-text'
          : 'border-sx-border text-sx-gray hover:text-white'
      }`}
    >
      {label}
    </Link>
  )
}

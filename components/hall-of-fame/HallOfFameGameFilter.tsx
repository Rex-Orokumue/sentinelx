import Link from 'next/link'

export interface FilterGame {
  id: string
  name: string
  slug: string
}

// Server-rendered URL-param filter, matching /tournaments rather than the
// client-state tabs used by SeasonGameTabs — a filtered hall of fame should be
// a shareable, indexable link.
//
// Renders nothing below two active games: a filter with a single option is
// noise, and this is exactly the state the platform sits in until a second game
// is activated.
export function HallOfFameGameFilter({
  games,
  activeSlug,
}: {
  games: FilterGame[]
  activeSlug: string | null
}) {
  if (games.length < 2) return null

  return (
    <nav aria-label="Filter by game" className="mb-8 flex flex-wrap justify-center gap-2">
      <Pill href="/hall-of-fame" label="All Games" active={!activeSlug} />
      {games.map((g) => (
        <Pill
          key={g.id}
          href={`/hall-of-fame?game=${g.slug}`}
          label={g.name}
          active={activeSlug === g.slug}
        />
      ))}
    </nav>
  )
}

function Pill({ href, label, active }: { href: string; label: string; active: boolean }) {
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

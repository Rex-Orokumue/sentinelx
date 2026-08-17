import Link from 'next/link'

// CLAUDE.md's Four Pillars, verbatim — replaces the old FeatureGrid, whose
// six-item list had drifted from the documented pillars (Compete/Watch/
// Community/Trade).
const PILLARS = [
  {
    emoji: '🎮',
    accent: 'bg-sx-purple/10 text-sx-purple-text',
    name: 'Compete',
    body: 'Enter tournaments, get matched, and prove your rank. Every result admin-verified — no disputes go unresolved.',
    href: '/tournaments',
  },
  {
    emoji: '📺',
    accent: 'bg-sx-amber/10 text-sx-amber',
    name: 'Watch',
    body: 'Sentinel X TV — live finals, match replays, and highlights. Every big match streamed on our YouTube channel.',
    href: '/tv',
  },
  {
    emoji: '🤝',
    accent: 'bg-sx-green/10 text-sx-green',
    name: 'Community',
    body: "Connect with Nigeria's best mobile gamers. Share clips, discuss tactics, and stay updated on platform news.",
    href: '/community',
  },
  {
    emoji: '🔒',
    accent: 'bg-blue-500/10 text-blue-400',
    name: 'Trade',
    body: 'Gaming Exchange powered by Zolarux escrow. Buy and sell gaming accounts with zero risk.',
    href: '/exchange',
  },
] as const

export function FourPillars() {
  return (
    <section className="mb-10 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {PILLARS.map((p) => (
        <Link
          key={p.name}
          href={p.href}
          className="flex flex-col gap-3.5 rounded-xl border border-sx-border bg-sx-surface p-5 transition-all hover:-translate-y-0.5 hover:border-sx-purple/40 hover:shadow-[0_0_15px_rgba(124,58,237,0.15)]"
        >
          <div className={`flex h-11 w-11 items-center justify-center rounded-[10px] text-xl ${p.accent}`}>
            {p.emoji}
          </div>
          <div>
            <p className="mb-1 font-display text-lg font-bold uppercase tracking-wide text-white">{p.name}</p>
            <p className="text-xs leading-relaxed text-sx-gray">{p.body}</p>
          </div>
        </Link>
      ))}
    </section>
  )
}

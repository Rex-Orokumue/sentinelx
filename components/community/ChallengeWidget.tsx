import type { ChallengeProgressView } from '@/lib/community/challenge-query'

// Sticky sidebar on desktop, collapsible banner on mobile (spec §8) — the
// collapse is pure CSS (a <details> element), no client JS needed.
export function ChallengeWidget({ weekLabel, challenges }: { weekLabel: string; challenges: ChallengeProgressView[] }) {
  return (
    <details className="group rounded-2xl border border-sx-border bg-sx-surface p-4 lg:sticky lg:top-20 lg:open:block" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 lg:cursor-default">
        <span className="text-xs font-black uppercase tracking-widest text-sx-white">This Week&apos;s Challenges</span>
        <span className="text-[11px] text-sx-gray">{weekLabel}</span>
      </summary>
      <div className="mt-3 space-y-3">
        {challenges.map((c) => (
          <ChallengeRow key={c.slug} challenge={c} />
        ))}
      </div>
    </details>
  )
}

function ChallengeRow({ challenge: c }: { challenge: ChallengeProgressView }) {
  const pct = Math.min(100, Math.round((c.progress / c.goal) * 100))
  const icon = c.completed ? '✅' : c.progress > 0 ? '🔄' : '🔲'
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-sx-white">
          {icon} {c.title}
        </span>
        <span className="text-sx-gray">
          {c.progress}/{c.goal} · +{c.coinReward} 🪙
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-sx-gray">{c.description}</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sx-bg">
        <div
          className={`h-full rounded-full ${c.completed ? 'bg-sx-green' : 'bg-sx-purple'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

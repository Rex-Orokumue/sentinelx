import Link from 'next/link'
import type { DashboardFixture } from '@/lib/dashboard/fixtures'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDateTime } from '@/lib/format'

const STATUS: Record<string, { label: string; cls: string }> = {
  live: { label: '🔴 Live', cls: 'text-red-400' },
  scheduled: { label: 'Upcoming', cls: 'text-slate-400' },
  completed: { label: 'Completed', cls: 'text-emerald-400' },
  disputed: { label: 'Disputed', cls: 'text-amber-400' },
  cancelled: { label: 'Cancelled', cls: 'text-slate-500' },
}

export function FixtureCard({ fixture }: { fixture: DashboardFixture }) {
  const s = STATUS[fixture.status] ?? { label: fixture.status, cls: 'text-slate-400' }
  return (
    <Link
      href={`/matches/${fixture.id}`}
      className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">vs {fixture.opponentName}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {fixture.tournamentTitle} · {formatDateTime(fixture.scheduledAt) ?? 'Time TBD'}
          </p>
        </div>
        {fixture.awaitingMyResult ? (
          <span className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white">
            Submit result →
          </span>
        ) : (
          <span className={`shrink-0 text-xs font-semibold ${s.cls}`}>{s.label}</span>
        )}
      </div>
    </Link>
  )
}

export function FixtureSection({
  fixtures,
}: {
  fixtures: { live: DashboardFixture[]; upcoming: DashboardFixture[]; completed: DashboardFixture[] }
}) {
  const total = fixtures.live.length + fixtures.upcoming.length + fixtures.completed.length
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My fixtures</h2>
      {total === 0 ? (
        <EmptyState
          icon="🎮"
          title="No fixtures yet"
          body="Register for a tournament and your matches will show up here."
        />
      ) : (
        <div className="space-y-5">
          <Group label="Live" items={fixtures.live} />
          <Group label="Upcoming" items={fixtures.upcoming} />
          <Group label="Completed" items={fixtures.completed} />
        </div>
      )}
    </section>
  )
}

function Group({ label, items }: { label: string; items: DashboardFixture[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <div className="space-y-2">
        {items.map((f) => (
          <FixtureCard key={f.id} fixture={f} />
        ))}
      </div>
    </div>
  )
}

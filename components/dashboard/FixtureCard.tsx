import Link from 'next/link'
import {
  buildOpponentWhatsAppUrl,
  groupFixturesByDate,
  type DashboardFixture,
  type FixtureDateGroup,
} from '@/lib/dashboard/fixtures'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatFixtureDate } from '@/lib/format'
import { ROUND_LABELS } from '@/lib/tournaments/bracket'

const STATUS: Record<string, { label: string; cls: string }> = {
  live: { label: '🔴 Live', cls: 'text-red-400' },
  scheduled: { label: 'Upcoming', cls: 'text-slate-400' },
  completed: { label: 'Completed', cls: 'text-emerald-400' },
  disputed: { label: 'Disputed', cls: 'text-amber-400' },
  cancelled: { label: 'Cancelled', cls: 'text-slate-500' },
  bye: { label: 'Bye', cls: 'text-slate-500' },
}

export function FixtureCard({ fixture }: { fixture: DashboardFixture }) {
  const s = STATUS[fixture.status] ?? { label: fixture.status, cls: 'text-slate-400' }
  const canMessageOpponent = fixture.status === 'live' || fixture.status === 'scheduled'
  const whatsappUrl = canMessageOpponent
    ? buildOpponentWhatsAppUrl({
        opponentWhatsapp: fixture.opponentWhatsapp,
        opponentName: fixture.opponentName,
        tournamentTitle: fixture.tournamentTitle,
        opponentCountry: fixture.opponentCountry,
      })
    : null

  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        fixture.status === 'scheduled' && !fixture.matchDayReached
          ? 'border-slate-800/60 bg-slate-900/60'
          : 'border-slate-800 bg-slate-900 hover:border-slate-600'
      }`}
    >
      <Link href={`/matches/${fixture.id}?from=dashboard`} className="block">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-white">
              {fixture.status === 'bye' ? 'Bye — auto-advanced' : `vs ${fixture.opponentName}`}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {fixture.tournamentTitle} · {ROUND_LABELS[fixture.round] ?? fixture.round} ·{' '}
              {formatFixtureDate(fixture.scheduledAt, fixture.isFullDay) ?? 'Time TBD'}
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
      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
        >
          Coordinate on WhatsApp
        </a>
      )}
    </div>
  )
}

export function ActiveFixtures({
  fixtures,
}: {
  fixtures: { live: DashboardFixture[]; upcoming: DashboardFixture[] }
}) {
  const total = fixtures.live.length + fixtures.upcoming.length
  if (total === 0) {
    return (
      <EmptyState
        icon="🎮"
        title="No active fixtures"
        body="Register for a tournament and your live/upcoming matches will show up here."
      />
    )
  }
  const upcomingGroups = groupFixturesByDate(fixtures.upcoming)
  return (
    <div className="space-y-5">
      <Group label="Live" items={fixtures.live} />
      {upcomingGroups.map((g: FixtureDateGroup) => (
        <Group key={g.dateLabel} label={g.dateLabel} items={g.fixtures} />
      ))}
    </div>
  )
}

export function CompletedFixtures({ fixtures }: { fixtures: DashboardFixture[] }) {
  if (fixtures.length === 0) {
    return <EmptyState icon="🏁" title="No completed matches yet" body="Finished matches will show up here." />
  }
  return <Group label="Completed" items={fixtures} />
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

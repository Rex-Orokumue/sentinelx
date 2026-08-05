import Link from 'next/link'
import { CollapsibleSection } from '@/components/dashboard/CollapsibleSection'

export interface ScheduleTournament {
  id: string
  title: string
  slug: string
  tournament_type: string
  status: string
  tournament_start: string | null
  invitation_only: boolean
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Upcoming',
  registration_open: 'Register',
  registration_closed: 'Upcoming',
  active: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function monthKey(iso: string | null): string {
  return iso ? iso.slice(0, 7) : 'tbd'
}

function monthLabel(key: string): string {
  if (key === 'tbd') return 'Date TBD'
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function SeasonSchedule({ tournaments }: { tournaments: ScheduleTournament[] }) {
  const byMonth = new Map<string, ScheduleTournament[]>()
  for (const t of tournaments) {
    const key = monthKey(t.tournament_start)
    const list = byMonth.get(key)
    if (list) list.push(t)
    else byMonth.set(key, [t])
  }
  const months = Array.from(byMonth.keys()).sort()

  return (
    <section className="mb-10">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Season Schedule</p>
      {months.length === 0 && <p className="text-sm text-sx-gray">No tournaments scheduled yet.</p>}
      {months.map((key, i) => (
        <CollapsibleSection key={key} id={`month-${key}`} title={monthLabel(key)} defaultOpen={i === 0}>
          <ul className="space-y-2">
            {byMonth.get(key)!.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-surface px-4 py-3"
              >
                <p className="text-sm font-semibold text-white">
                  {t.tournament_type === 'masters' ? '👑 ' : '📅 '}
                  {t.title}
                </p>
                <Link
                  href={`/tournaments/${t.slug}`}
                  className="shrink-0 rounded-full border border-sx-border px-2.5 py-1 text-[11px] font-bold text-white/80 transition-colors hover:border-sx-purple/40"
                >
                  {t.invitation_only && t.status === 'registration_open' ? 'Invite Only' : STATUS_LABEL[t.status] ?? t.status}
                </Link>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ))}
    </section>
  )
}

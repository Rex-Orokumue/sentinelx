import Link from 'next/link'
import type { UpcomingEventItem } from '@/lib/community/upcoming-events-query'

export function UpcomingEventsWidget({ events }: { events: UpcomingEventItem[] }) {
  if (events.length === 0) return null
  return (
    <div className="rounded-2xl border border-sx-border bg-sx-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-sx-white">Upcoming Tournaments</h2>
        <Link href="/tournaments" className="text-[11px] font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View All →
        </Link>
      </div>
      <div className="space-y-3">
        {events.map((e) => {
          const [day, month] = e.date.split(' ')
          return (
            <div key={e.id} className="flex items-center gap-3">
              <div className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-sx-purple/30 bg-sx-purple/10 py-1">
                <span className="text-[10px] font-bold uppercase text-sx-purple-text">{month ?? ''}</span>
                <span className="text-sm font-black text-white">{day}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{e.title}</p>
                <p className="text-[11px] text-sx-gray">{e.time}</p>
              </div>
              <Link
                href={e.ctaHref}
                className="shrink-0 rounded-lg bg-sx-green px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90"
              >
                {e.ctaLabel}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { EmptyState } from '@/components/shared/EmptyState'
import type { ProfileMatch } from '@/lib/players/profile'

const OUTCOME_ICON: Record<string, string> = { win: '🏆', loss: '📉', draw: '➖' }
const OUTCOME_VERB: Record<string, string> = { win: 'Won vs', loss: 'Lost vs', draw: 'Drew vs' }

// "X ago" from a real completed_at timestamp — no fabricated event types
// (win-streak milestones, "played" events) the schema doesn't record.
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProfileRecentActivity({ matches }: { matches: ProfileMatch[] }) {
  const recent = matches.slice(0, 5)
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Recent Activity</h2>
      </div>
      {recent.length === 0 ? (
        <EmptyState icon="🕒" title="No activity yet" body="Match results will show up here." />
      ) : (
        <ul className="space-y-3">
          {recent.map((m) => (
            <li key={m.id} className="flex items-start gap-2.5 text-sm">
              <span className="shrink-0">{OUTCOME_ICON[m.outcome]}</span>
              <div className="min-w-0">
                <p className="truncate text-white">
                  {OUTCOME_VERB[m.outcome]} {m.opponentName}
                </p>
                <p className="text-xs text-sx-gray">{timeAgo(m.completedAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

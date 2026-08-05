import Link from 'next/link'
import { formatDate, formatNaira } from '@/lib/format'

export interface TournamentCardData {
  id: string
  title: string
  slug: string
  prize_pool: number
  registration_fee: number
  status: string
  tournament_start: string | null
  registration_end: string | null
  tournament_end?: string | null
  max_players: number | null
  format?: string | null
  tournament_type?: string | null
  games: { name: string; icon_url: string | null } | null
}

const STATUS: Record<string, { label: string; cls: string; dot?: boolean }> = {
  active:              { label: 'LIVE',        cls: 'bg-sx-green/10 text-sx-green border-sx-green/30', dot: true },
  registration_open:   { label: 'OPEN',        cls: 'bg-sx-green/10 text-sx-green border-sx-green/30' },
  registration_closed: { label: 'UPCOMING',    cls: 'bg-sx-amber/10 text-sx-amber border-sx-amber/30' },
  completed:           { label: 'ENDED',       cls: 'bg-white/5 text-sx-gray border-white/10' },
}

// "single_elimination" → "Single Elimination"
function humanize(value: string): string {
  return value
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
}

export function TournamentCard({
  tournament: t,
  featured = false,
}: {
  tournament: TournamentCardData
  featured?: boolean
}) {
  const status = STATUS[t.status] ?? STATUS.completed

  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className={`block rounded-xl border bg-sx-surface p-5 transition-all hover:border-sx-purple/40 hover:shadow-[0_0_15px_rgba(124,58,237,0.15)] ${
        featured ? 'border-sx-purple/30' : 'border-sx-border'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sx-purple-text">
            {t.games?.name ?? 'Mobile Esports'}
          </p>
          <h3 className={`font-display font-bold leading-tight text-white ${featured ? 'text-2xl' : 'text-lg'}`}>
            {t.title}
          </h3>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${status.cls}`}
        >
          {status.dot && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sx-green" />}
          {status.label}
        </span>
      </div>

      {(t.format || t.tournament_type) && (
        <div className="mb-4 flex flex-wrap gap-3 text-xs text-sx-gray">
          {t.max_players != null && <span>👥 {t.max_players} Players</span>}
          {t.format && <span>⚔️ {humanize(t.format)}</span>}
          {t.tournament_type && <span>🏆 {humanize(t.tournament_type)}</span>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-5">
        <div>
          <p className="text-[11px] text-sx-gray">Prize Pool</p>
          <p className={`font-display font-black text-sx-purple-text ${featured ? 'text-2xl' : 'text-lg'}`}>
            {formatNaira(t.prize_pool)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-sx-gray">Entry Fee</p>
          <p className={`font-display font-black text-white ${featured ? 'text-2xl' : 'text-lg'}`}>
            {formatNaira(t.registration_fee)}
          </p>
        </div>
        {t.max_players != null && (
          <div>
            <p className="text-[11px] text-sx-gray">Max Players</p>
            <p className={`font-display font-black text-white ${featured ? 'text-2xl' : 'text-lg'}`}>
              {t.max_players}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-sx-gray">
        <span>
          {t.tournament_start && <>Starts {formatDate(t.tournament_start)}</>}
          {t.tournament_end && <> · Ends {formatDate(t.tournament_end)}</>}
        </span>
        {t.registration_end && t.status === 'registration_open' && (
          <span className="font-semibold text-sx-green">● Registration Open</span>
        )}
        {t.status === 'registration_closed' && t.tournament_start && (
          <span className="font-semibold text-sx-amber">Starts {formatDate(t.tournament_start)}</span>
        )}
      </div>
    </Link>
  )
}

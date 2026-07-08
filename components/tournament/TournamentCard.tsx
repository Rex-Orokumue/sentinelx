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
  max_players: number | null
  games: { name: string; icon_url: string | null } | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  active:              { label: 'LIVE',        cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  registration_open:   { label: 'OPEN',        cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  registration_closed: { label: 'REG. CLOSED', cls: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  completed:           { label: 'ENDED',       cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
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
      className={`block rounded-2xl border bg-slate-900 p-5 transition-all hover:border-violet-500/40 hover:bg-slate-800 ${
        featured ? 'border-violet-500/30' : 'border-slate-800'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {t.games?.name ?? 'Mobile Esports'}
          </p>
          <h3 className={`font-bold leading-tight text-white ${featured ? 'text-xl' : 'text-base'}`}>
            {t.title}
          </h3>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-5">
        <div>
          <p className="text-[11px] text-slate-500">Prize Pool</p>
          <p className={`font-black text-violet-400 ${featured ? 'text-2xl' : 'text-lg'}`}>
            {formatNaira(t.prize_pool)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500">Entry Fee</p>
          <p className={`font-black text-white ${featured ? 'text-2xl' : 'text-lg'}`}>
            {formatNaira(t.registration_fee)}
          </p>
        </div>
        {t.max_players != null && (
          <div>
            <p className="text-[11px] text-slate-500">Max Players</p>
            <p className={`font-black text-white ${featured ? 'text-2xl' : 'text-lg'}`}>
              {t.max_players}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        {t.tournament_start && <span>Starts {formatDate(t.tournament_start)}</span>}
        {t.registration_end && t.status === 'registration_open' && (
          <span className="text-violet-400/80">Reg. closes {formatDate(t.registration_end)}</span>
        )}
      </div>
    </Link>
  )
}

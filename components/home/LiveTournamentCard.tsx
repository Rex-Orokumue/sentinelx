import Image from 'next/image'
import Link from 'next/link'
import { formatDate, formatNaira } from '@/lib/format'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'

// Right column of the homepage "Stats + Live Tournament" section (spec §3.1 §4).
// `tournament` is the first active/open tournament, newest first — same source
// the page already fetches for the old featured-tournament section.
export function LiveTournamentCard({ tournament: t }: { tournament: TournamentCardData | null }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">Live Tournament</p>
        {t?.status === 'active' && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-sx-green">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sx-green" />
            LIVE
          </span>
        )}
      </div>

      {t ? (
        <Link
          href={`/tournaments/${t.slug}`}
          className="relative block overflow-hidden rounded-xl border border-sx-border bg-sx-surface p-5 transition-colors hover:border-sx-purple/40"
        >
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-sx-purple-text">
            {t.games?.name ?? 'Mobile Esports'}
          </p>
          <h3 className="mb-4 pr-16 font-display text-xl font-bold leading-tight text-white">{t.title}</h3>

          <div className="mb-4 flex flex-wrap gap-5">
            <div>
              <p className="text-[11px] text-sx-gray">Prize Pool</p>
              <p className="font-display text-lg font-black text-sx-purple-text">{formatNaira(t.prize_pool)}</p>
            </div>
            <div>
              <p className="text-[11px] text-sx-gray">Entry Fee</p>
              <p className="font-display text-lg font-black text-white">{formatNaira(t.registration_fee)}</p>
            </div>
            {t.max_players != null && (
              <div>
                <p className="text-[11px] text-sx-gray">Max Players</p>
                <p className="font-display text-lg font-black text-white">{t.max_players}</p>
              </div>
            )}
          </div>

          {t.tournament_start && (
            <p className="mb-4 text-xs text-sx-gray">Starts {formatDate(t.tournament_start)}</p>
          )}

          <span className="inline-flex items-center gap-1 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light">
            View Tournament <span aria-hidden>→</span>
          </span>

          {/* Mascot peek, bottom-right corner of the card */}
          <div className="pointer-events-none absolute bottom-0 right-2 h-16 w-16 opacity-90 sm:h-20 sm:w-20">
            <Image
              src="/mascot/mascot-bubble.png"
              alt=""
              fill
              sizes="80px"
              className="object-contain object-bottom"
            />
          </div>
        </Link>
      ) : (
        <div className="rounded-xl border border-sx-border bg-sx-surface p-8 text-center">
          <p className="text-3xl">🎮</p>
          <p className="mt-3 font-bold text-white">No active tournament right now</p>
          <p className="mt-1 text-sm text-sx-gray">
            Join the WhatsApp community to be notified when the next one drops.
          </p>
        </div>
      )}
    </div>
  )
}

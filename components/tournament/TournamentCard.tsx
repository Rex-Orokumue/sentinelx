import Link from 'next/link'
import { formatDate, formatNaira } from '@/lib/format'
import { resolveTournamentImageUrl } from '@/lib/games/icon'
import { gameGenreEmoji } from '@/lib/games/genre-emoji'

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
  card_image_url?: string | null
  games: { name: string; icon_url: string | null; slug?: string | null; category?: string | null } | null
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
  variant = 'grid',
}: {
  tournament: TournamentCardData
  featured?: boolean
  /** 'row' = horizontal (listing page); 'grid' = image-on-top (homepage grid). */
  variant?: 'grid' | 'row'
}) {
  const status = STATUS[t.status] ?? STATUS.completed
  // Champions Cup — the annual invitational flagship (see
  // supabase/migrations/047_season_system.sql's tournament_type check
  // constraint: 'open' | 'community_club' | 'masters' | 'champions_cup').
  // Gets the gold-accent treatment; the mockup's "Season Championship" card.
  const isChampionsCup = t.tournament_type === 'champions_cup'
  const isRow = variant === 'row'

  const gameName = t.games?.name ?? 'Mobile Esports'
  const imageUrl = resolveTournamentImageUrl(t.card_image_url, t.games)
  const emoji = gameGenreEmoji(t.games?.category)

  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className={`group flex overflow-hidden rounded-xl border transition-all hover:-translate-y-0.5 ${
        isRow ? 'flex-row' : 'flex-col'
      } ${
        isChampionsCup
          ? 'border-sx-amber/25 bg-gradient-to-br from-sx-amber/[0.06] to-sx-surface hover:shadow-[0_0_15px_rgba(245,158,11,0.15)]'
          : `bg-sx-surface hover:shadow-[0_0_15px_rgba(124,58,237,0.15)] ${
              featured ? 'border-sx-purple/30' : 'border-sx-border hover:border-sx-purple/40'
            }`
      }`}
    >
      <CardImage isRow={isRow} src={imageUrl} emoji={emoji} alt={gameName} />

      <div className={`flex min-w-0 flex-1 flex-col ${isRow ? 'p-4 sm:p-5' : 'p-5'}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <span
            className={`min-w-0 truncate rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
              isChampionsCup ? 'border-sx-amber/25 text-sx-amber' : 'border-sx-border text-sx-gray'
            }`}
          >
            {isChampionsCup ? 'Season Championship' : gameName}
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${status.cls}`}
          >
            {status.dot && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sx-green" />}
            {status.label}
          </span>
        </div>

        <h3
          className={`mb-3.5 font-display font-bold leading-tight ${
            featured && !isRow ? 'text-2xl' : 'text-lg'
          } ${isChampionsCup ? 'text-sx-amber' : 'text-white'}`}
        >
          {t.title}
        </h3>

        <div className="mb-4 grid flex-1 grid-cols-2 gap-x-3 gap-y-2.5">
          <Stat label="Prize Pool" value={formatNaira(t.prize_pool)} accent="gold" />
          <Stat label="Format" value={t.format ? humanize(t.format) : '—'} />
          {isChampionsCup ? (
            <>
              <Stat label="Eligibility" value="Top 16 Players" />
              <Stat label="Qualifier" value="Auto — Season Points" />
            </>
          ) : (
            <>
              <Stat label="Entry Fee" value={formatNaira(t.registration_fee)} />
              <Stat
                label={t.status === 'registration_closed' ? 'Starts' : 'Max Players'}
                value={
                  t.status === 'registration_closed' && t.tournament_start
                    ? formatDate(t.tournament_start) ?? '—'
                    : t.max_players != null
                      ? String(t.max_players)
                      : '—'
                }
                accent={t.status === 'registration_open' ? 'green' : undefined}
              />
            </>
          )}
        </div>

        <span
          className={`block rounded-lg py-2.5 text-center font-display text-xs font-bold uppercase tracking-wide ${
            isChampionsCup
              ? 'border border-sx-amber/30 text-sx-amber'
              : t.status === 'registration_open'
                ? 'bg-sx-purple text-white'
                : 'border border-white/10 text-sx-gray'
          }`}
        >
          {isChampionsCup
            ? 'Learn More'
            : t.status === 'registration_open'
              ? `Register Now — ${formatNaira(t.registration_fee)}`
              : 'View Details'}
        </span>
      </div>
    </Link>
  )
}

function CardImage({
  isRow,
  src,
  emoji,
  alt,
}: {
  isRow: boolean
  src: string | null
  emoji: string
  alt: string
}) {
  const shape = isRow
    ? 'w-28 shrink-0 self-stretch sm:w-40'
    : 'h-36 w-full'

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-sx-purple/25 to-sx-surface ${shape}`}>
      {src ? (
        // card_image_url and the local /games art are plain URLs; next/image
        // has no remotePatterns configured.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-4xl opacity-80">
          {emoji}
        </span>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'gold' | 'green' }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-sx-gray/80">{label}</p>
      <p
        className={`font-display text-sm font-bold ${
          accent === 'gold' ? 'text-sx-amber' : accent === 'green' ? 'text-sx-green' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

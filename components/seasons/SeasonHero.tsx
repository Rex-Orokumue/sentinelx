import { Crown } from 'lucide-react'
import type { SeasonTierLabels } from '@/lib/games/season-tier-labels'

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function SeasonHero({
  season,
  tournaments,
  playersCompeting,
  tierLabels,
}: {
  season: { name: string; start_date: string; end_date: string }
  tournaments: { tournament_type: string; status: string }[]
  playersCompeting: number
  tierLabels: SeasonTierLabels
}) {
  const clubsCompleted = tournaments.filter((t) => t.tournament_type === 'community_club' && t.status === 'completed').length
  const mastersCompleted = tournaments.filter((t) => t.tournament_type === 'masters' && t.status === 'completed').length

  return (
    <div className="relative mb-8 overflow-hidden rounded-2xl border border-sx-border bg-sx-surface p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sx-purple/20 blur-[90px]"
      />
      <div className="relative flex items-center gap-2">
        <Crown className="h-5 w-5 text-sx-purple-text" />
        <p className="text-xs font-bold uppercase tracking-widest text-sx-purple-text">{season.name}</p>
      </div>
      <h1 className="relative mt-2 font-display text-3xl font-black uppercase text-white sm:text-4xl">
        {formatMonthYear(season.start_date)} – {formatMonthYear(season.end_date)}
      </h1>
      <div className="relative mt-5 flex flex-wrap gap-3 text-xs font-bold">
        <span className="rounded-full border border-sx-border bg-sx-bg px-3.5 py-1.5 text-white/80">
          {clubsCompleted} {tierLabels.communityClub} completed
        </span>
        <span className="rounded-full border border-sx-border bg-sx-bg px-3.5 py-1.5 text-white/80">
          {mastersCompleted} {tierLabels.masters} completed
        </span>
        <span className="rounded-full border border-sx-purple/30 bg-sx-purple/10 px-3.5 py-1.5 text-sx-purple-text">
          {playersCompeting} players competing
        </span>
      </div>
    </div>
  )
}

import Link from 'next/link'
import type { TournamentBanner } from '@/lib/dashboard/tournament-status'
import { ROUND_LABELS } from '@/lib/tournaments/bracket'

function bannerCopy(banner: NonNullable<TournamentBanner>): string {
  if (banner.kind === 'eliminated') {
    const roundLabel = banner.round === 'group' ? 'Group Stage' : ROUND_LABELS[banner.round] ?? banner.round
    return `You were eliminated from ${banner.tournamentTitle} after the ${roundLabel}. Thanks for competing! 🎮`
  }
  if (banner.round === 'knockout stage') {
    return `🎉 You made the knockout stage in ${banner.tournamentTitle} — the draw will appear here once every group finishes.`
  }
  const roundLabel = ROUND_LABELS[banner.round] ?? banner.round
  return banner.awaitingOpponent
    ? `🎉 You advanced to the ${roundLabel} in ${banner.tournamentTitle} — sit tight for your next fixture.`
    : `🎉 You advanced to the ${roundLabel} in ${banner.tournamentTitle}!`
}

export function TournamentStatusBanners({ banners }: { banners: NonNullable<TournamentBanner>[] }) {
  if (banners.length === 0) return null
  return (
    <div className="mb-5 space-y-2">
      {banners.map((banner) => (
        <Link
          key={`${banner.tournamentSlug}-${banner.kind}`}
          href={`/tournaments/${banner.tournamentSlug}/bracket`}
          className={`block rounded-2xl border p-4 text-sm font-semibold transition-colors ${
            banner.kind === 'qualified'
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:border-emerald-600'
              : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-600'
          }`}
        >
          {bannerCopy(banner)}
        </Link>
      ))}
    </div>
  )
}

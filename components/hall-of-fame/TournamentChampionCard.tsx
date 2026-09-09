import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { formatDate, formatNaira } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'
import type { ChampionEntry } from '@/lib/tournaments/champions'

// The champion card for tournaments outside the DLS competition structure
// (tournament_type 'open'). Deliberately a sibling of CommunityClubCard so the
// Hall of Fame sections read as one family; the game badge is the addition,
// since this section mixes games while the others historically did not.
export function TournamentChampionCard({
  entry,
  membershipTier,
  frameUrl,
}: {
  entry: ChampionEntry
  membershipTier: string | null
  frameUrl?: string
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
      <div className="flex justify-center">
        <HexAvatar
          src={entry.championAvatarUrl}
          username={entry.champion.name}
          tier={(membershipTier ?? 'recruit') as MembershipTier}
          size="md"
          frameUrl={frameUrl}
        />
      </div>

      <p className="mt-2 font-bold text-white">{entry.champion.name}</p>

      {entry.gameName && (
        <span className="mt-1 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sx-gray">
          {entry.gameName}
        </span>
      )}

      <div className="mt-2 border-t border-sx-border pt-2 text-xs text-sx-gray">
        🏆 {entry.title}
        <br />
        {formatDate(entry.date) ?? 'Date TBD'}
        {entry.prizePool != null && entry.prizePool > 0 && (
          <>
            <br />
            <span className="font-semibold text-sx-purple-text">{formatNaira(entry.prizePool)}</span>
          </>
        )}
        <br />
        <Link
          href={`/tournaments/${entry.slug}`}
          className="mt-1 inline-block font-semibold text-sx-purple-text hover:text-sx-purple-light"
        >
          View →
        </Link>
      </div>

      {entry.runnerUp && <p className="mt-1.5 text-[11px] text-sx-gray">🥈 {entry.runnerUp.name}</p>}
    </div>
  )
}

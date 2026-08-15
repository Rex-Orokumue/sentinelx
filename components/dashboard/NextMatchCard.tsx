import Link from 'next/link'
import { Suspense } from 'react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { CountdownChip } from '@/components/dashboard/CountdownChip'
import { NextMatchInvitationCard } from '@/components/dashboard/NextMatchInvitationCard'
import { formatCountdown } from '@/lib/dashboard/countdown'
import { ROUND_LABELS } from '@/lib/tournaments/bracket'
import { formatFixtureDate } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface NextMatchData {
  id: string
  status: string
  round: string
  scheduledAt: string | null
  isFullDay: boolean
  tournamentTitle: string
  myAvatarUrl: string | null
  myDisplayName: string
  myTier: MembershipTier
  opponentAvatarUrl: string | null
  opponentDisplayName: string
  opponentTier: MembershipTier
  submitted: boolean
}

export function NextMatchCard({
  match,
  invitation,
}: {
  match: NextMatchData | null
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number } | null
}) {
  // State C — a pending invitation replaces this card entirely, same slot.
  if (invitation) return <NextMatchInvitationCard invitation={invitation} />

  // State B — nothing scheduled.
  if (!match) {
    return (
      <div className="rounded-2xl border border-sx-border bg-sx-surface p-6 text-center">
        <p className="text-lg font-bold text-white">🎮 No match scheduled</p>
        <p className="mt-1 text-sm text-sx-gray">You have no upcoming fixtures. Enter a tournament to compete.</p>
        <Link
          href="/tournaments"
          className="mt-4 inline-block rounded-xl bg-sx-purple px-6 py-3 text-sm font-bold text-white hover:bg-sx-purple-light"
        >
          Browse Tournaments
        </Link>
      </div>
    )
  }

  const isLive = match.status === 'live'
  const needsResult = !isLive && match.scheduledAt != null && new Date(match.scheduledAt) <= new Date() && !match.submitted
  const headerLabel = isLive ? '🔴 LIVE NOW' : needsResult ? '⚠ SUBMIT YOUR RESULT' : '⚔ YOUR NEXT MATCH'
  const ctaLabel = isLive ? 'ENTER MATCH' : needsResult ? 'SUBMIT RESULT' : 'VIEW MATCH'

  return (
    <div
      className="rounded-2xl border border-sx-purple bg-sx-surface p-5"
      style={{ boxShadow: '0 0 24px rgba(124,58,237,0.25)' }}
    >
      <div className="flex items-center justify-between border-b border-sx-border pb-3">
        <p className="text-sm font-bold uppercase tracking-wide text-white">{headerLabel}</p>
        {isLive ? (
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase text-red-400">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-red-500" /> LIVE
          </span>
        ) : match.scheduledAt && !needsResult ? (
          <Suspense fallback={<span className="text-xs font-bold uppercase text-sx-purple-text">{formatCountdown(match.scheduledAt, new Date())}</span>}>
            <CountdownChip scheduledAt={match.scheduledAt} />
          </Suspense>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-4 py-5">
        <div className="flex flex-col items-center gap-1.5">
          <HexAvatar src={match.myAvatarUrl} username={match.myDisplayName} tier={match.myTier} size="sm" />
          <p className="text-xs font-bold text-white">YOU</p>
        </div>
        <span className="text-sm font-bold uppercase text-sx-gray">vs</span>
        <div className="flex flex-col items-center gap-1.5">
          <HexAvatar src={match.opponentAvatarUrl} username={match.opponentDisplayName} tier={match.opponentTier} size="sm" />
          <p className="max-w-[7rem] truncate text-xs font-bold text-white">{match.opponentDisplayName}</p>
        </div>
      </div>

      <div className="border-t border-sx-border pt-3 text-center">
        <p className="text-sm text-white">
          {match.tournamentTitle} · {ROUND_LABELS[match.round] ?? match.round}
        </p>
        <p className="mt-0.5 text-xs text-sx-gray">{formatFixtureDate(match.scheduledAt, match.isFullDay) ?? 'Time TBD'}</p>
      </div>

      <Link
        href={`/matches/${match.id}`}
        className="mt-4 block rounded-xl bg-sx-purple py-3 text-center text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        {ctaLabel}
      </Link>
    </div>
  )
}

import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatDate } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'
import type { PlayerRef, PostView } from '@/lib/community/feed-query'
import { ReactionBar } from './ReactionBar'
import { ShareButton } from './ShareButton'

function PlayerColumn({ player, isWinner }: { player: PlayerRef | null; isWinner: boolean }) {
  const name = player?.displayName ?? player?.username ?? 'Player'
  const content = (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <HexAvatar src={player?.avatarUrl ?? null} username={name} tier={(player?.membershipTier ?? 'recruit') as MembershipTier} size="sm" />
      <p className={`max-w-[6rem] truncate text-xs font-bold ${isWinner ? 'text-sx-white' : 'text-sx-gray'}`}>{name}</p>
      <TierBadge tier={player?.sentinelTier ?? null} />
    </div>
  )
  return player?.username ? (
    <Link href={`/players/${player.username}`} className="hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  )
}

// Spec §5.2 — distinct, more prominent treatment for system-generated match
// results. No delete option for either player; admin-only moderation via
// /admin/community.
export function MatchResultCard({ post, loggedIn }: { post: PostView; loggedIn: boolean }) {
  const m = post.matchResult
  const scoreA = m?.scoreA ?? null
  const scoreB = m?.scoreB ?? null
  const aWins = scoreA != null && scoreB != null && scoreA > scoreB
  const bWins = scoreA != null && scoreB != null && scoreB > scoreA

  return (
    <div className="rounded-2xl border border-sx-purple/40 bg-sx-surface p-4 shadow-[0_0_24px_-8px_rgba(124,58,237,0.5)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-sx-purple-text">🏆 Match Result</p>
        <p className="truncate text-xs text-sx-gray">{m?.tournamentTitle}</p>
      </div>

      {m ? (
        <>
          <div className="mt-4 flex items-center justify-center gap-4 sm:gap-8">
            <PlayerColumn player={m.playerA} isWinner={aWins} />
            <p className="shrink-0 font-display text-2xl font-black text-sx-white">
              {scoreA ?? '–'} <span className="text-sx-gray">–</span> {scoreB ?? '–'}
            </p>
            <PlayerColumn player={m.playerB} isWinner={bWins} />
          </div>
          <p className="mt-4 border-t border-sx-border pt-3 text-center text-xs text-sx-gray">
            {m.roundLabel}
            {formatDate(m.scheduledAt) ? ` · ${formatDate(m.scheduledAt)}` : ''}
          </p>
        </>
      ) : (
        <p className="mt-3 whitespace-pre-line text-sm text-sx-gray">{post.content}</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <ReactionBar postId={post.id} counts={post.reactionCounts} myReaction={post.myReaction} loggedIn={loggedIn} />
        <div className="flex items-center gap-3">
          <Link href={`/community/${post.id}`} className="text-xs font-semibold text-sx-gray hover:text-sx-white">
            💬 {post.commentCount}
          </Link>
          <ShareButton post={post} />
        </div>
      </div>
      {m && (
        <Link href={`/matches/${m.matchId}`} className="mt-2 block text-right text-xs font-bold text-sx-purple-text hover:text-sx-purple-light">
          View Match →
        </Link>
      )}
    </div>
  )
}

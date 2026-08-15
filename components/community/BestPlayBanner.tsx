import Link from 'next/link'
import type { BestPlayNominationView } from '@/lib/community/best-play-query'
import { VoteButton } from './VoteButton'

// Spec §9 — voting banner at the top of the feed during the Fri 9am-Sun 9pm
// WAT window. Server Component; only the vote button itself is interactive.
export function BestPlayBanner({
  nominations,
  myVoteNominationId,
  loggedIn,
}: {
  nominations: BestPlayNominationView[]
  myVoteNominationId: string | null
  loggedIn: boolean
}) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-xs font-black uppercase tracking-widest text-amber-400">🎯 Vote for Best Play</p>
      <div className="mt-3 space-y-2">
        {nominations.map((n) => {
          const hasVoted = myVoteNominationId === n.nominationId
          return (
            <div key={n.nominationId} className="flex items-center justify-between gap-3 rounded-lg border border-sx-border bg-sx-surface p-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-sx-white">{n.authorName}</p>
                <Link href={`/community/${n.postId}`} className="line-clamp-1 text-xs text-sx-gray hover:text-sx-white">
                  {n.content || 'View post →'}
                </Link>
              </div>
              <VoteButton nominationId={n.nominationId} voteCount={n.voteCount} hasVoted={hasVoted} disabled={!loggedIn || myVoteNominationId != null} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

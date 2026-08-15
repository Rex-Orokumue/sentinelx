'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toggleReaction } from '@/lib/community/reaction-actions'
import { REACTIONS, type ReactionType } from '@/lib/community/schema'

const EMOJI: Record<ReactionType, string> = { fire: '🔥', crown: '👑', strong: '💪', wow: '😮' }

// Spec §5.1 — one reaction per player per post; tapping the same one removes
// it, tapping a different one replaces it. Guests get bounced to login
// (spec §4) rather than a silent failed request.
export function ReactionBar({
  postId,
  counts,
  myReaction,
  loggedIn,
}: {
  postId: string
  counts: Record<ReactionType, number>
  myReaction: ReactionType | null
  loggedIn: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [local, setLocal] = useState({ counts, mine: myReaction })

  function onTap(reaction: ReactionType) {
    if (!loggedIn) {
      router.push('/login?next=/community')
      return
    }
    if (pending) return

    const prev = local
    const nextCounts = { ...prev.counts }
    if (prev.mine) nextCounts[prev.mine] = Math.max(0, nextCounts[prev.mine] - 1)
    const removing = prev.mine === reaction
    if (!removing) nextCounts[reaction] = nextCounts[reaction] + 1
    setLocal({ counts: nextCounts, mine: removing ? null : reaction })

    startTransition(async () => {
      const res = await toggleReaction(postId, reaction)
      if (res?.error) {
        setLocal(prev) // roll back on failure
        router.refresh()
      }
    })
  }

  return (
    <div className="flex items-center gap-2.5">
      {REACTIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onTap(r)}
          className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-bold transition-colors ${
            local.mine === r ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-sx-white'
          }`}
        >
          <span>{EMOJI[r]}</span>
          <span>{local.counts[r]}</span>
        </button>
      ))}
    </div>
  )
}

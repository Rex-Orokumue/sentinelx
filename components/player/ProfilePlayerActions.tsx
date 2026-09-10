'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Ban } from 'lucide-react'
import { startConversation, blockUser, unblockUser } from '@/lib/messages/actions'
import { AddFriendButton } from '@/components/player/AddFriendButton'
import { ChallengeButton } from '@/components/player/ChallengeButton'
import type { FriendshipStatus } from '@/lib/friends/list'

export function ProfilePlayerActions({
  profileId,
  friendshipStatus,
  blockedByMe,
}: {
  profileId: string
  friendshipStatus: FriendshipStatus
  blockedByMe: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(blockedByMe)

  function openConversation() {
    start(async () => {
      setError(null)
      const res = await startConversation(profileId)
      if (res.error || !res.threadId) {
        setError(res.error ?? 'Could not open the conversation.')
        return
      }
      router.push(`/messages/${res.threadId}`)
    })
  }

  function toggleBlock() {
    start(async () => {
      setError(null)
      const res = blocked ? await unblockUser(profileId) : await blockUser(profileId)
      if (res.error) {
        setError(res.error)
        return
      }
      setBlocked((b) => !b)
      router.refresh()
    })
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2 sm:items-start">
      <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
        <FriendStatusInline status={friendshipStatus} profileId={profileId} />
        <ChallengeButton opponentId={profileId} />
        {!blocked && (
          <button
            type="button"
            disabled={pending}
            onClick={openConversation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-sx-purple/50 disabled:opacity-50"
          >
            <MessageCircle className="h-3.5 w-3.5" /> {pending ? 'Opening…' : 'Message'}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={toggleBlock}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-sx-gray hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
        >
          <Ban className="h-3.5 w-3.5" /> {blocked ? 'Unblock' : 'Block'}
        </button>
      </div>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}

// Copied verbatim from ProfileHeader's private FriendStatusAction so this
// component is self-contained.
function FriendStatusInline({ status, profileId }: { status: FriendshipStatus; profileId: string }) {
  if (status === 'friends') {
    return <p className="text-sm font-semibold text-sx-green">✓ Friends</p>
  }
  if (status === 'pending_sent') {
    return <p className="text-sm text-sx-gray">Friend request sent</p>
  }
  if (status === 'pending_received') {
    return <p className="text-sm text-sx-gray">They sent you a friend request — check your dashboard</p>
  }
  return <AddFriendButton recipientId={profileId} />
}

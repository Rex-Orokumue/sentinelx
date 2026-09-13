'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, UserCheck } from 'lucide-react'
import { followPlayer, unfollowPlayer } from '@/lib/follows/actions'

export function FollowButton({ profileId, initialFollowing }: { profileId: string; initialFollowing: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [following, setFollowing] = useState(initialFollowing)
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    start(async () => {
      setError(null)
      const res = following ? await unfollowPlayer(profileId) : await followPlayer(profileId)
      if (res.error) {
        setError(res.error)
        return
      }
      setFollowing((f) => !f)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-center gap-1 sm:items-start">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={
          following
            ? 'inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-red-500/50 hover:text-red-400 disabled:opacity-50'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-sx-purple/40 bg-sx-purple/20 px-3 py-1.5 text-xs font-bold text-sx-purple-text hover:bg-sx-purple/30 disabled:opacity-50'
        }
      >
        {following ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
        {pending ? '…' : following ? 'Following' : 'Follow'}
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}

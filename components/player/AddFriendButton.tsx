'use client'
import { useFormState } from 'react-dom'
import { sendFriendRequest, type FriendActionState } from '@/lib/friends/actions'

export function AddFriendButton({ recipientId }: { recipientId: string }) {
  const [state, action] = useFormState<FriendActionState, FormData>(sendFriendRequest, undefined)
  if (state?.success) {
    return <p className="text-sm text-emerald-400">Request sent.</p>
  }
  return (
    <form action={action}>
      <input type="hidden" name="recipientId" value={recipientId} />
      <button
        type="submit"
        className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-bold text-violet-400 hover:bg-violet-500/10"
      >
        Add friend
      </button>
      {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

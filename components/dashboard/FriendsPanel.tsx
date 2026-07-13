'use client'
import { useFormState } from 'react-dom'
import {
  acceptFriendRequest,
  removeFriend,
  type FriendActionState,
} from '@/lib/friends/actions'

export interface FriendRequestRow {
  id: string
  requesterName: string
  requesterUsername: string | null
}

export interface FriendRow {
  id: string
  friendName: string
  friendUsername: string | null
}

export function FriendsPanel({
  incoming,
  friends,
}: {
  incoming: FriendRequestRow[]
  friends: FriendRow[]
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Friends</h2>

      {incoming.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Requests</p>
          {incoming.map((r) => (
            <IncomingRequestRow key={r.id} req={r} />
          ))}
        </div>
      )}

      {friends.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No friends yet — send a request from a player's profile.
        </p>
      ) : (
        <div className="space-y-2">
          {friends.map((f) => (
            <FriendRow key={f.id} friend={f} />
          ))}
        </div>
      )}
    </section>
  )
}

function IncomingRequestRow({ req }: { req: FriendRequestRow }) {
  const [state, action] = useFormState<FriendActionState, FormData>(acceptFriendRequest, undefined)
  const [declineState, declineAction] = useFormState<FriendActionState, FormData>(removeFriend, undefined)
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="min-w-0 truncate text-sm font-semibold text-white">
        {req.requesterName} {req.requesterUsername ? `(@${req.requesterUsername})` : ''}
      </p>
      <div className="flex shrink-0 gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={req.id} />
          <button type="submit" className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500">
            Accept
          </button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="id" value={req.id} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500">
            Decline
          </button>
        </form>
      </div>
      {(state?.error || declineState?.error) && (
        <p className="text-xs text-red-400">{state?.error || declineState?.error}</p>
      )}
    </div>
  )
}

function FriendRow({ friend }: { friend: FriendRow }) {
  const [state, action] = useFormState<FriendActionState, FormData>(removeFriend, undefined)
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="min-w-0 truncate text-sm font-semibold text-white">
        {friend.friendName} {friend.friendUsername ? `(@${friend.friendUsername})` : ''}
      </p>
      <form action={action}>
        <input type="hidden" name="id" value={friend.id} />
        <button type="submit" className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300">
          Remove
        </button>
      </form>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  )
}

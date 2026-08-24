import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FriendsPanel, type FriendRequestRow, type FriendRow } from '@/components/dashboard/FriendsPanel'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Friends · SentinelX Esports', robots: { index: false, follow: false } }

type FriendProfileRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null
function friendProfileName(p: FriendProfileRef): { name: string; username: string | null; avatarUrl: string | null } {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return { name: r?.display_name ?? r?.username ?? 'Player', username: r?.username ?? null, avatarUrl: r?.avatar_url ?? null }
}

export default async function DashboardFriendsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/friends')

  const { data: friendsRes } = await supabase
    .from('friends')
    .select(
      'id, requester_id, recipient_id, status, ' +
        'requester:profiles!friends_requester_id_fkey(username, display_name, avatar_url), ' +
        'recipient:profiles!friends_recipient_id_fkey(username, display_name, avatar_url)',
    )
    .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`)

  const rawFriends = ((friendsRes as unknown[] | null) ?? []) as {
    id: string; requester_id: string; recipient_id: string; status: string
    requester: FriendProfileRef; recipient: FriendProfileRef
  }[]
  const incomingRequests: FriendRequestRow[] = rawFriends
    .filter((f) => f.status === 'pending' && f.recipient_id === user.id)
    .map((f) => {
      const p = friendProfileName(f.requester)
      return { id: f.id, requesterName: p.name, requesterUsername: p.username, requesterAvatarUrl: p.avatarUrl }
    })
  const friendsList: FriendRow[] = rawFriends
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const otherIsRequester = f.recipient_id === user.id
      const p = friendProfileName(otherIsRequester ? f.requester : f.recipient)
      return { id: f.id, friendName: p.name, friendUsername: p.username, friendAvatarUrl: p.avatarUrl }
    })

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Friends</h1>
      <FriendsPanel incoming={incomingRequests} friends={friendsList} />
    </DashboardShell>
  )
}

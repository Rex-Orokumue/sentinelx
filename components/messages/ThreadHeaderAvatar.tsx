'use client'
import { Avatar } from '@/components/shared/Avatar'
import { useIsOnline } from '@/components/messages/PresenceProvider'

// Thin client wrapper so the thread page itself can stay a server component
// — only the presence dot needs the browser-side context.
export function ThreadHeaderAvatar({
  otherId,
  avatarUrl,
  displayName,
  username,
}: {
  otherId: string
  avatarUrl: string | null
  displayName: string | null
  username: string | null
}) {
  const online = useIsOnline(otherId)
  return <Avatar avatarUrl={avatarUrl} displayName={displayName} username={username} size={32} online={online} />
}

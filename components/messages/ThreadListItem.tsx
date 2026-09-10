import Link from 'next/link'
import { Avatar } from '@/components/shared/Avatar'
import { formatRelativeTime } from '@/lib/format'
import type { ThreadSummary } from '@/lib/messages/query'

export function ThreadListItem({ thread }: { thread: ThreadSummary }) {
  const preview = thread.lastMessage ?? (thread.lastWasImage ? '📷 Photo' : 'No messages yet')
  return (
    <Link
      href={`/messages/${thread.threadId}`}
      className="flex items-center gap-3 rounded-xl border border-sx-border bg-sx-surface px-3 py-3 transition-colors hover:border-sx-purple/40"
    >
      <Avatar avatarUrl={thread.otherAvatarUrl} displayName={thread.otherName} username={thread.otherUsername} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-white">{thread.otherName}</p>
          <span className="ml-auto shrink-0 text-[11px] text-sx-gray">{formatRelativeTime(thread.lastMessageAt)}</span>
        </div>
        <p className={`truncate text-xs ${thread.unread > 0 ? 'font-semibold text-white' : 'text-sx-gray'}`}>{preview}</p>
      </div>
      {thread.unread > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-sx-purple px-1.5 text-[11px] font-bold text-white">
          {thread.unread > 99 ? '99+' : thread.unread}
        </span>
      )}
    </Link>
  )
}

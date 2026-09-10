import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fetchThread } from '@/lib/messages/query'
import { Avatar } from '@/components/shared/Avatar'
import { Conversation } from '@/components/messages/Conversation'
import { ThreadMenu } from '@/components/messages/ThreadMenu'

export const metadata: Metadata = { title: 'Conversation · SentinelX Esports', robots: { index: false, follow: false } }

export default async function ThreadPage({ params }: { params: { threadId: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/messages/${params.threadId}`)

  const detail = await fetchThread(params.threadId, user.id)
  if (!detail) notFound()

  return (
    <div className="mx-auto max-w-2xl px-0 sm:px-4">
      {/* Not sticky (unlike ExchangeSubHeader, deliberately): a second sticky bar
          stacked under SiteHeader would need a hardcoded header-height offset
          that breaks the moment that header wraps. The composer below is the
          only thing pinned to the viewport, via `sticky bottom-0` in
          MessageComposer — no height arithmetic needed anywhere on this page. */}
      <header className="flex items-center gap-2 border-b border-sx-border px-3 py-2">
        <Link href="/messages" aria-label="Back to messages" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/5">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Link href={detail.other.username ? `/players/${detail.other.username}` : '#'} className="flex min-w-0 items-center gap-2">
          <Avatar avatarUrl={detail.other.avatarUrl} displayName={detail.other.name} username={detail.other.username} size={32} />
          <span className="truncate text-sm font-bold text-white">{detail.other.name}</span>
        </Link>
        <div className="ml-auto">
          <ThreadMenu threadId={detail.threadId} otherId={detail.other.id} otherName={detail.other.name} blockedByMe={detail.blockedByMe} />
        </div>
      </header>
      <Conversation detail={detail} viewerId={user.id} />
    </div>
  )
}

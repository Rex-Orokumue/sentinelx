import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchThreadList } from '@/lib/messages/query'
import { ThreadListItem } from '@/components/messages/ThreadListItem'
import { MessagesRealtime } from '@/components/messages/MessagesRealtime'

export const metadata: Metadata = { title: 'Messages · SentinelX Esports', robots: { index: false, follow: false } }

export default async function MessagesPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/messages')

  const threads = await fetchThreadList(user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <MessagesRealtime />
      <h1 className="mb-4 font-display text-2xl font-black uppercase text-white">Messages</h1>
      {threads.length === 0 ? (
        <div className="rounded-xl border border-sx-border bg-sx-surface p-8 text-center">
          <p className="text-sm text-sx-gray">No conversations yet.</p>
          <Link href="/players" className="mt-3 inline-block text-sm font-bold text-sx-purple-text hover:text-sx-purple-light">
            Find players to message →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <ThreadListItem key={t.threadId} thread={t} />
          ))}
        </div>
      )}
    </div>
  )
}

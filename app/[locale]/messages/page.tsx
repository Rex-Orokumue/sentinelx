import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, SquarePen } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { fetchThreadList } from '@/lib/messages/query'
import { ThreadListItem } from '@/components/messages/ThreadListItem'
import { MessagesRealtime } from '@/components/messages/MessagesRealtime'

export const metadata: Metadata = { title: 'Messages · SentinelX Esports', robots: { index: false, follow: false } }

export default async function MessagesPage({ searchParams }: { searchParams: { box?: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/messages')

  const showRequests = searchParams.box === 'requests'
  const [threads, requests, t] = await Promise.all([
    showRequests ? Promise.resolve([]) : fetchThreadList(user.id),
    fetchThreadList(user.id, 'requests'),
    getTranslations('dmRequests'),
  ])

  if (showRequests) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
        <MessagesRealtime />
        <div className="mb-4 flex items-center gap-2">
          <Link href="/messages" aria-label={t('backToMessages')} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/5">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-2xl font-black uppercase text-white">{t('requestsTab')}</h1>
        </div>
        {requests.length === 0 ? (
          <div className="rounded-xl border border-sx-border bg-sx-surface p-8 text-center">
            <p className="text-sm text-sx-gray">{t('requestsEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <ThreadListItem key={r.threadId} thread={r} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <MessagesRealtime />
      {/* Compose is always here, not just in the empty state below — before
          this, starting a NEW conversation once you already had one meant
          leaving the page to find the player's profile again. */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-black uppercase text-white">Messages</h1>
        <Link
          href="/players"
          aria-label="New message"
          className="flex h-9 w-9 items-center justify-center rounded-full text-sx-purple-text transition-colors hover:bg-white/5"
        >
          <SquarePen className="h-5 w-5" />
        </Link>
      </div>
      {requests.length > 0 && (
        <Link
          href="/messages?box=requests"
          className="mb-3 flex items-center justify-between rounded-xl border border-sx-purple/40 bg-sx-surface px-4 py-3 text-sm font-bold text-white transition-colors hover:border-sx-purple"
        >
          <span>{t('requestsTab')}</span>
          <span className="rounded-full bg-sx-purple px-2.5 py-0.5 text-xs">{t('requestsCount', { count: requests.length })}</span>
        </Link>
      )}
      {threads.length === 0 ? (
        <div className="rounded-xl border border-sx-border bg-sx-surface p-8 text-center">
          <p className="text-sm text-sx-gray">No conversations yet.</p>
          <Link href="/players" className="mt-3 inline-block text-sm font-bold text-sx-purple-text hover:text-sx-purple-light">
            Find players to message →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((th) => (
            <ThreadListItem key={th.threadId} thread={th} />
          ))}
        </div>
      )}
    </div>
  )
}

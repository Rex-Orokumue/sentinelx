'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Coalesce a burst of events into one refresh. A single reaction fires one
// event, but a busy post can fire several within a second — refreshing per
// event would re-render the server component repeatedly for the same result.
const REFRESH_DEBOUNCE_MS = 400

// Keeps the community feed and post pages live. Comments and reactions used to
// require a manual reload before anything appeared — including your own,
// which made the app feel broken at the exact moment a player had just
// interacted with it.
//
// Refreshes the route rather than merging rows into local state. Feed data is
// hydrated server-side — reaction counts, comment counts, author profiles,
// match details — so rebuilding a post from a raw realtime row would duplicate
// that logic and drift from it. router.refresh() re-runs the server component
// and is correct by construction; the debounce is what keeps it cheap.
//
// `postId` scopes the subscription on a post detail page. Omitted on the feed,
// where any post's activity is relevant.
export function CommunityRealtime({ postId }: { postId?: string }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    function scheduleRefresh() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
    }

    // A distinct channel name per scope, so the feed and an open post do not
    // share (and clobber) one subscription.
    const channel = supabase.channel(postId ? `community:post:${postId}` : 'community:feed')

    for (const table of ['post_comments', 'post_reactions'] as const) {
      channel.on(
        'postgres_changes',
        {
          // Reactions are toggled and changed, comments are soft-deleted, so
          // INSERT alone would miss most of what changes on screen.
          event: '*',
          schema: 'public',
          table,
          ...(postId ? { filter: `post_id=eq.${postId}` } : {}),
        },
        scheduleRefresh,
      )
    }

    channel.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [router, postId])

  return null
}

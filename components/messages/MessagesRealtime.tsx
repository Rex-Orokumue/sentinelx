'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { markAllThreadsDelivered } from '@/lib/messages/actions'

// The list is fully server-hydrated (previews, unread, other-party profiles),
// so re-running the server component is correct-by-construction — same as
// CommunityRealtime. RLS scopes the subscription; a 400ms debounce keeps a
// burst cheap.
//
// This is also where "delivered" gets stamped for threads the viewer isn't
// currently reading: mounting the list at all means the viewer just came
// online, so it catches up anything sent while they were away, and a live
// INSERT here (a message arriving while the list is open but the specific
// thread isn't) is the single check flipping to a double one in real time.
export function MessagesRealtime() {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    void markAllThreadsDelivered()
    const channel = supabase
      .channel('dm:list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, (payload) => {
        if (payload.eventType === 'INSERT') void markAllThreadsDelivered()
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => router.refresh(), 400)
      })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [router])
  return null
}

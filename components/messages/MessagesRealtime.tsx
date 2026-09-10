'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// The list is fully server-hydrated (previews, unread, other-party profiles),
// so re-running the server component is correct-by-construction — same as
// CommunityRealtime. RLS scopes the subscription; a 400ms debounce keeps a
// burst cheap.
export function MessagesRealtime() {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel('dm:list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, () => {
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

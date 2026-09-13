'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// A lean twin of NotificationBell — same refresh-on-nav + realtime pattern,
// but no dropdown: /messages IS the inbox, so a click just goes there. The
// badge counts unread `player_notifications` rows of type 'direct_message'
// rather than dm_messages directly — every DM already creates one of those
// (notifyInApp in lib/messages/actions.ts) and markThreadRead already flips
// it back to read, so this rides existing plumbing instead of a second
// thread-membership query.
export function MessagesBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const pathname = usePathname()

  // Mounted once in the root layout — its initial prop never re-runs
  // server-side on a client-side navigation (e.g. leaving /messages after
  // reading everything there), so a fresh count is fetched on every soft nav.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { count } = await supabase
        .from('player_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .eq('type', 'direct_message')
        .eq('read', false)
      if (!cancelled) setUnreadCount(count ?? 0)
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [pathname])

  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null
    let cancelled = false
    async function subscribe() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      channel = supabase
        .channel(`messages-badge:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'player_notifications', filter: `player_id=eq.${user.id}` },
          (payload) => {
            const row = payload.new as { type: string }
            if (row.type === 'direct_message') setUnreadCount((c) => c + 1)
          },
        )
        .subscribe()
    }
    subscribe()
    return () => {
      cancelled = true
      if (channel) createClient().removeChannel(channel)
    }
  }, [])

  return (
    <Link
      href="/messages"
      aria-label="Messages"
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/5"
    >
      <MessageCircle className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  )
}

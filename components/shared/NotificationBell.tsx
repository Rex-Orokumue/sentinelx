'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationDrawer } from './NotificationDrawer'
import { listenForegroundMessages } from '@/components/notifications/useFCM'
import type { NotificationItem } from '@/lib/nav/session'

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationItem[]
  initialUnreadCount: number
}) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const pathname = usePathname()

  // Same "fetch fresh on every soft nav" contract as before this rewrite —
  // the bell is mounted once in the root layout and its initial props
  // never re-run server-side on a client-side navigation.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const [{ count }, { data: rows }] = await Promise.all([
        supabase.from('player_notifications').select('id', { count: 'exact', head: true }).eq('player_id', user.id).eq('read', false),
        supabase
          .from('player_notifications')
          .select('id, type, title, body, link, read, created_at')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return
      setUnreadCount(count ?? 0)
      setNotifications((rows ?? []).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.created_at })))
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [pathname])

  // Realtime: fires on every INSERT into this player's own rows (RLS still
  // applies to realtime — the filter here is belt-and-suspenders, not the
  // only guard). Subscribed once per mount, not per pathname change.
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
        .channel(`player_notifications:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'player_notifications', filter: `player_id=eq.${user.id}` },
          (payload) => {
            const row = payload.new as { id: string; type: string; title: string; body: string; link: string | null; read: boolean; created_at: string }
            setNotifications((prev) => [
              { id: row.id, type: row.type, title: row.title, body: row.body, link: row.link, read: row.read, createdAt: row.created_at },
              ...prev,
            ])
            setUnreadCount((c) => c + 1)
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

  // Foreground push: onBackgroundMessage in firebase-messaging-sw.js only
  // fires when this tab isn't focused. Without this, a push that arrives
  // while the player is actively on the site is received by the SDK and
  // silently dropped — no OS toast, nothing. See useFCM.ts for the
  // showNotification() call this triggers. No-op if push was never
  // enabled/configured; safe to call unconditionally.
  useEffect(() => {
    listenForegroundMessages()
  }, [])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/5"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer
          notifications={notifications}
          onClose={() => setOpen(false)}
          onNotificationsChange={(next) => {
            setNotifications(next)
            setUnreadCount(next.filter((n) => !n.read).length)
          }}
        />
      )}
    </div>
  )
}

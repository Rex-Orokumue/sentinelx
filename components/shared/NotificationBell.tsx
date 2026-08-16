'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
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
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  // The bell is mounted once in the root layout and persists across
  // client-side navigations — its initial props never re-run server-side
  // on a soft nav, so it must fetch its own fresh count/list on every
  // pathname change instead of trusting stale initial props.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const [{ count }, { data: rows }] = await Promise.all([
        supabase
          .from('player_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', user.id)
          .eq('read', false),
        supabase
          .from('player_notifications')
          .select('id, type, title, body, link, read, created_at')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return
      setUnreadCount(count ?? 0)
      setNotifications(
        (rows ?? []).map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.read,
          createdAt: n.created_at,
        })),
      )
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [pathname])

  async function onSelect(n: NotificationItem) {
    setOpen(false)
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
      const supabase = createClient()
      await supabase.from('player_notifications').update({ read: true }).eq('id', n.id)
      router.refresh()
    }
    if (n.link) router.push(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/5"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        // w-80 (320px) fixed width, right-0 anchored to a 36px bell wrapper
        // that isn't flush with the viewport edge (header padding + the
        // hamburger button sit to its right) — on a narrow phone the left
        // edge landed off-screen. Capping width to the smaller of 20rem and
        // (viewport - 2rem margin) keeps it fully on-screen at any width
        // without changing how it's anchored or styled otherwise — a
        // tactical fix only; the full notification-center rebuild
        // (docs/superpowers/specs/2026-08-16-notification-center-design.md)
        // replaces this dropdown with a drawer, so a deeper redesign here
        // would be wasted/conflicting work.
        <div className="absolute right-0 mt-2 max-h-96 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-sx-gray">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelect(n)}
                className={`block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-white/5 ${
                  n.read ? 'opacity-60' : ''
                }`}
              >
                <p className="font-semibold text-white">{n.title}</p>
                <p className="mt-0.5 text-xs text-sx-gray">{n.body}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

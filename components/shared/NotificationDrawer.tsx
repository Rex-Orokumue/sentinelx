'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X, Bell, Trophy, MessageCircle, Coins, Award, Megaphone, AlertTriangle } from 'lucide-react'
import type { NotificationItem } from '@/lib/nav/session'
import { markNotificationRead, markAllNotificationsRead, loadMoreNotifications } from '@/lib/notifications/drawer-actions'

const ICONS: Record<string, typeof Bell> = {
  result_confirmed: Trophy,
  prize_credited: Coins,
  wallet_credited: Coins,
  wager_settled: Coins,
  achievement_unlocked: Award,
  referral_credited: Award,
  post_comment: MessageCircle,
  post_reaction: MessageCircle,
  tournament_announced: Megaphone,
  new_announcement: Megaphone,
  player_disqualified: AlertTriangle,
  noshow_needs_decision: AlertTriangle,
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationDrawer({
  notifications,
  onClose,
  onNotificationsChange,
}: {
  notifications: NotificationItem[]
  onClose: () => void
  onNotificationsChange: (next: NotificationItem[]) => void
}) {
  const router = useRouter()
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  async function handleSelect(n: NotificationItem) {
    onClose()
    if (!n.read) {
      onNotificationsChange(notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      void markNotificationRead(n.id)
    }
    if (n.link) router.push(n.link)
  }

  async function handleMarkAllRead() {
    onNotificationsChange(notifications.map((x) => ({ ...x, read: true })))
    void markAllNotificationsRead()
  }

  async function handleLoadMore() {
    setLoadingMore(true)
    const more = await loadMoreNotifications(notifications.length)
    if (more.length === 0) setExhausted(true)
    onNotificationsChange([...notifications, ...more])
    setLoadingMore(false)
  }

  // Portaled to document.body — SiteHeader's <header> has backdrop-blur-md
  // (a CSS backdrop-filter), and per spec a filter/backdrop-filter on an
  // ancestor creates a new containing block for `position: fixed`
  // descendants. Rendered in place (as NotificationBell's child, which is a
  // header descendant), this drawer's `fixed inset-0` sized itself against
  // the header's own ~60px box instead of the viewport — the drawer showed
  // as a sliver clipped to the header's height instead of covering the
  // screen. Portaling to body sidesteps the containing-block chain
  // entirely, matching how MobileNavSheet avoids the same trap by being a
  // sibling of <header> rather than a descendant.
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-sx-border bg-sx-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-sx-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">Notifications</h2>
          <div className="flex items-center gap-3">
            {notifications.some((n) => !n.read) && (
              <button type="button" onClick={handleMarkAllRead} className="text-xs text-sx-purple-text hover:underline">
                Mark all read
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-sx-gray">You&apos;re all caught up 🎮</p>
          ) : (
            notifications.map((n) => {
              const Icon = ICONS[n.type] ?? Bell
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleSelect(n)}
                  className={`flex w-full items-start gap-3 border-b border-sx-border px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                    n.read ? '' : 'bg-sx-purple/5'
                  }`}
                >
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sx-purple" />}
                  <Icon className={`h-4 w-4 shrink-0 ${n.read ? 'text-sx-gray' : 'text-sx-purple-text'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{n.title}</p>
                    <p className="mt-0.5 truncate text-xs text-sx-gray">{n.body}</p>
                    <p className="mt-1 text-[10px] text-sx-gray/70">{relativeTime(n.createdAt)}</p>
                  </div>
                </button>
              )
            })
          )}
          {notifications.length > 0 && !exhausted && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full py-3 text-center text-xs text-sx-purple-text hover:underline disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

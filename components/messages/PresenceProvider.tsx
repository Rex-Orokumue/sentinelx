'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PRESENCE_TOPIC = 'dm-online'

const OnlineContext = createContext<Set<string>>(new Set())

export function useIsOnline(userId: string | null | undefined): boolean {
  const online = useContext(OnlineContext)
  return !!userId && online.has(userId)
}

// Tracks the viewer's own presence on a single shared channel for as long as
// they have any page on the site open, and exposes who else is currently on
// it — consumed via useIsOnline() for the green dot on Avatar. "Online"
// means "has a tab on the site open right now," not "logged in at some
// point today" — backgrounding a mobile browser/PWA suspends the socket
// within moments, so the dot tracks foreground use, matching the accuracy
// the DM thread view always wanted. Mounted once, site-wide, in
// app/[locale]/layout.tsx (only when navSession.isLoggedIn) — it used to be
// scoped to just the Messages pages, which meant the dot went stale for
// anyone browsing elsewhere on the site.
//
// The channel is private — Realtime Authorization requires that for
// presence — authorized by the dm_presence_* policies on realtime.messages
// in supabase/migrations/20260913193000_dm_delivered_at_and_presence.sql.
//
// Supabase Realtime's socket can drop silently (see the same note in
// Conversation.tsx); without resubscribing, everyone would look frozen
// offline/online until a manual reload. That error callback itself depends
// on a heartbeat that a backgrounded tab freezes, so it can lag well past
// "the user just came back" — a visibilitychange listener forces a fresh
// subscribe right then instead of waiting for it.
export function PresenceProvider({ viewerId, children }: { viewerId: string; children: React.ReactNode }) {
  const [online, setOnline] = useState<Set<string>>(new Set())

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let currentChannel: ReturnType<typeof supabase.channel> | null = null

    function subscribe() {
      const channel = supabase.channel(PRESENCE_TOPIC, {
        config: { private: true, presence: { key: viewerId } },
      })
      currentChannel = channel

      channel.on('presence', { event: 'sync' }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())))
      })

      channel.subscribe(async (status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() })
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          supabase.removeChannel(channel)
          retryTimer = setTimeout(subscribe, 2000)
        }
      })
    }
    subscribe()

    function onVisible() {
      if (document.visibilityState !== 'visible') return
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      if (currentChannel) supabase.removeChannel(currentChannel)
      subscribe()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (retryTimer) clearTimeout(retryTimer)
      if (currentChannel) supabase.removeChannel(currentChannel)
    }
  }, [viewerId])

  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>
}

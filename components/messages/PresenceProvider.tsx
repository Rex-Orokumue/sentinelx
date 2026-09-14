'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PRESENCE_TOPIC = 'dm-online'

const OnlineContext = createContext<Set<string>>(new Set())

export function useIsOnline(userId: string | null | undefined): boolean {
  const online = useContext(OnlineContext)
  return !!userId && online.has(userId)
}

// Tracks the viewer's own presence on a single shared channel while any
// Messages page is mounted, and exposes who else is currently on it —
// consumed via useIsOnline() for the green dot on Avatar. Scoped to the
// Messages feature, not the whole app: "online" means "has a Messages page
// open right now," not "is logged in somewhere on the site." Mount this
// once, in app/[locale]/messages/layout.tsx, above both the thread-list and
// thread-detail pages.
//
// The channel is private — Realtime Authorization requires that for
// presence — authorized by the dm_presence_* policies on realtime.messages
// in supabase/migrations/20260913193000_dm_delivered_at_and_presence.sql.
//
// Supabase Realtime's socket can drop silently (see the same note in
// Conversation.tsx); without resubscribing, everyone would look frozen
// offline/online until a manual reload.
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

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (currentChannel) supabase.removeChannel(currentChannel)
    }
  }, [viewerId])

  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>
}

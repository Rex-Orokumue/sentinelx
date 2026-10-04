'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createTypingSender, createTypingTracker, typingTopic } from '@/lib/messages/typing'

// Subscribes to the thread's private typing channel while `enabled`, and exposes whether the OTHER player is typing
// plus a throttled `notifyTyping` for the composer. Best-effort throughout: a typing indicator must never break the
// conversation, so every failure is swallowed. The tracker and sender are rebuilt per thread so nothing carries over
// when the component is reused for a different conversation.
export function useThreadTyping(threadId: string, viewerId: string, otherId: string, enabled: boolean) {
  const [typing, setTyping] = useState(false)
  const senderRef = useRef<ReturnType<typeof createTypingSender> | null>(null)

  useEffect(() => {
    senderRef.current = null
    setTyping(false)
    if (!enabled) return
    const tracker = createTypingTracker(Date.now)
    const supabase = createClient()
    const channel = supabase.channel(typingTopic(threadId), {
      config: { private: true, broadcast: { self: false } },
    })
    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const userId = (payload as { userId?: string } | null)?.userId
      if (!userId || userId === viewerId) return
      tracker.onEvent(userId)
      setTyping(tracker.isTyping(otherId))
    })
    senderRef.current = createTypingSender(Date.now, () => {
      void channel
        .send({ type: 'broadcast', event: 'typing', payload: { userId: viewerId } })
        .catch(() => undefined)
    })
    channel.subscribe()
    // Expires the indicator when events stop arriving.
    const interval = setInterval(() => setTyping(tracker.isTyping(otherId)), 1000)
    return () => {
      clearInterval(interval)
      senderRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [threadId, viewerId, otherId, enabled])

  const notifyTyping = useCallback(() => senderRef.current?.notifyKeystroke(), [])
  return { typing, notifyTyping }
}

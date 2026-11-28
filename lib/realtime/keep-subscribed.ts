// Keeps one Supabase Realtime channel open, reopening it after a failure.
//
// Removing a channel makes Realtime report CLOSED to that same channel, often
// synchronously. A status callback that removes on CLOSED therefore re-enters
// itself until "Maximum call stack size exceeded". Here a channel's reports are
// ignored from the moment we decide to drop it, and retries are limited.

import type { RealtimeChannel } from '@supabase/supabase-js'

export const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000]

interface Options {
  client: { removeChannel(channel: RealtimeChannel): unknown }
  // Builds a fresh channel with its listeners attached, not yet subscribed.
  create: () => RealtimeChannel
  onSubscribed?: (channel: RealtimeChannel) => void
  delays?: number[]
}

export function keepSubscribed({ client, create, onSubscribed, delays = RETRY_DELAYS_MS }: Options) {
  let current: RealtimeChannel | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let stopped = false
  // Identifies the latest wish to open, so overlapping restarts open only once.
  let wanted = 0

  function drop(): Promise<unknown> {
    if (timer) clearTimeout(timer)
    timer = null
    const channel = current
    // Cleared before removing: the CLOSED that removal triggers must find it stale.
    current = null
    return Promise.resolve(channel ? client.removeChannel(channel) : undefined)
  }

  // Waits for the removal first: until it finishes, the client hands back the
  // old channel for the same topic, which can't be subscribed again.
  function openAfter(removal: Promise<unknown>, ticket: number) {
    const go = () => {
      if (!stopped && ticket === wanted) open()
    }
    removal.then(go, go)
  }

  function open() {
    const channel = create()
    current = channel
    channel.subscribe((status) => {
      if (stopped || channel !== current) return
      if (status === 'SUBSCRIBED') {
        attempts = 0
        onSubscribed?.(channel)
        return
      }
      if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return
      const removal = drop()
      if (attempts >= delays.length) return // give up until restart()
      const ticket = ++wanted
      timer = setTimeout(() => openAfter(removal, ticket), delays[attempts++])
    })
  }

  open()

  return {
    // A fresh start with a full set of retries, e.g. when the tab becomes visible.
    restart() {
      if (stopped) return
      attempts = 0
      openAfter(drop(), ++wanted)
    },
    stop() {
      stopped = true
      void drop()
    },
  }
}

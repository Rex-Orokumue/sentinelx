// Typing indicator rules, kept pure so they are testable without a socket. The transport is a PER-THREAD private
// Realtime broadcast channel whose membership policy lives in 20261005120000_dm_typing_broadcast_policies.sql — never
// the site-wide `dm-online` presence channel, which every online player can read.
export const TYPING_SEND_INTERVAL_MS = 3000
export const TYPING_EXPIRE_MS = 5000

export const typingTopic = (threadId: string) => `dm-typing:${threadId}`

// At most one `typing` event per interval while the player keeps typing.
export function createTypingSender(now: () => number, send: () => void) {
  let last = -Infinity
  return {
    notifyKeystroke() {
      const t = now()
      if (t - last >= TYPING_SEND_INTERVAL_MS) {
        last = t
        send()
      }
    },
  }
}

// "Typing" for a short window after the last event; nothing is stored.
export function createTypingTracker(now: () => number) {
  const seen = new Map<string, number>()
  return {
    onEvent(userId: string) {
      seen.set(userId, now())
    },
    isTyping(userId: string) {
      const t = seen.get(userId)
      return t !== undefined && now() - t < TYPING_EXPIRE_MS
    },
  }
}

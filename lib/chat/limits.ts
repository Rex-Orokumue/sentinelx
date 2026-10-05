import { z } from 'zod'
import { CHAT_LOCALES, type ChatMessage } from './types'

// A reply the model wrote earlier is resent as history, and replies can be longer than anything a player types,
// so assistant messages get a larger cap (the client truncates to these before sending).
export const MAX_USER_MESSAGE_CHARS = 1000
export const MAX_ASSISTANT_MESSAGE_CHARS = 4000
export const MAX_HISTORY_MESSAGES = 20
export const MAX_HISTORY_CHARS = 8000
const capFor = (role: ChatMessage['role']) => (role === 'user' ? MAX_USER_MESSAGE_CHARS : MAX_ASSISTANT_MESSAGE_CHARS)

export const chatBodySchema = z.object({
  messages: z
    .array(
      z.discriminatedUnion('role', [
        z.object({ role: z.literal('user'), content: z.string().min(1).max(MAX_USER_MESSAGE_CHARS) }),
        z.object({ role: z.literal('assistant'), content: z.string().min(1).max(MAX_ASSISTANT_MESSAGE_CHARS) }),
      ]),
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES)
    .refine((m) => m[m.length - 1].role === 'user', { message: 'last_message_must_be_user' })
    .refine((m) => m.reduce((n, x) => n + x.content.length, 0) <= MAX_HISTORY_CHARS, { message: 'history_too_long' }),
  clientTurnId: z.string().uuid(),
  locale: z.enum(CHAT_LOCALES as unknown as [string, ...string[]]).default('en'),
})

// Lenient variant for the web route (which has always accepted whatever the client sent).
export function clampHistory(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ ...m, content: m.content.slice(0, capFor(m.role)) }))
  let total = 0
  const out: ChatMessage[] = []
  for (let i = recent.length - 1; i >= 0; i--) {
    total += recent[i].content.length
    if (total > MAX_HISTORY_CHARS) break
    out.unshift(recent[i])
  }
  return out
}

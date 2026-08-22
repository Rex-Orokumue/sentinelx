export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export const MAX_HISTORY_MESSAGES = 40

// Pure — unit tested directly. The client-sent history array is untrusted
// input: this strips anything that isn't a plain {role: 'user'|'assistant',
// content: string} entry (a tampered request body could otherwise inject a
// fake {role: 'system', ...} to override the real system prompt, or a fake
// {role: 'tool', ...} to fabricate an account-snapshot result) and caps
// length so one long-running conversation can't blow up request size or
// Groq token cost indefinitely. See docs/superpowers/specs/2026-08-22-
// support-chatbot-design.md §3 "Sanitization (hard rule)".
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const item of raw) {
    if (
      item !== null &&
      typeof item === 'object' &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string'
    ) {
      out.push({ role: item.role, content: item.content })
    }
  }
  return out.slice(-MAX_HISTORY_MESSAGES)
}

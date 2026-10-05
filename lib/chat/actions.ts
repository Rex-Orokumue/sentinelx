'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearChatHistory, listChatHistory } from './history'

// Lazy, on-panel-open fetch. The reads and the delete go through the shared history service (the same one the
// mobile /chat/history endpoints use): the user id comes from the session, the window is the last 30 days, and
// "Clear chat" is a server action rather than a direct client delete.
export async function getChatHistory(): Promise<
  { ok: true; messages: { role: 'user' | 'assistant'; content: string }[] } | { ok: false; error: string }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  try {
    const page = await listChatHistory(createAdminClient(), user.id, { limit: 50 })
    return { ok: true, messages: page.messages.map((m) => ({ role: m.role, content: m.content })) }
  } catch {
    return { ok: false, error: 'Could not load chat history.' }
  }
}

export async function clearMyChatHistory(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  try {
    await clearChatHistory(createAdminClient(), user.id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not clear chat history.' }
  }
}

'use server'
import { createClient } from '@/lib/supabase/server'

// Lazy, on-panel-open fetch — same pattern as lib/guide/actions.ts's
// getQuestStatus(). Uses the session client (not admin) so RLS's
// chat_messages_self_select policy does the access control.
export async function getChatHistory(): Promise<
  { ok: true; messages: { role: 'user' | 'assistant'; content: string }[] } | { ok: false; error: string }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('player_id', user.id)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) return { ok: false, error: 'Could not load chat history.' }
  return { ok: true, messages: (data ?? []) as { role: 'user' | 'assistant'; content: string }[] }
}

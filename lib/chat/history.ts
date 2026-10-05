import type { createAdminClient } from '@/lib/supabase/admin'
import { decodeCursor, encodeCursor, keysetFilter } from '@/lib/mobile-api/history-cursor'
import type { ChatRole } from './types'

type Admin = ReturnType<typeof createAdminClient>
export const HISTORY_DAYS = 30

export async function listChatHistory(admin: Admin, userId: string, opts: { before?: string; limit?: number }) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 40))
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
  let q = admin.from('chat_messages').select('id, role, content, created_at').eq('player_id', userId).gte('created_at', since)
  if (opts.before) q = q.or(keysetFilter(decodeCursor(opts.before)))
  const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  if (error) throw new Error('chat history read failed')
  const rows = (data ?? []) as { id: string; role: ChatRole; content: string; created_at: string }[]
  const page = rows.slice(0, limit)
  return {
    messages: page.slice().reverse().map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at })),
    nextBefore: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  }
}

export async function clearChatHistory(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from('chat_messages').delete().eq('player_id', userId)
  if (error) throw new Error('chat history clear failed')
}

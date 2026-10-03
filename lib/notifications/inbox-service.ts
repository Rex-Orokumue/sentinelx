import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Both are scoped by player_id on top of the id, so an unknown id and someone else's id are
// indistinguishable to the caller (not_found). An already-read row still matches, so marking twice is a success.
export async function markRead(admin: Admin, userId: string, id: string): Promise<'ok' | 'not_found'> {
  const { data, error } = await admin
    .from('player_notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('player_id', userId)
    .select('id')
  if (error) {
    console.error('[inbox] markRead failed', { code: error.code, message: error.message })
    throw new Error('could not mark notification read')
  }
  return (data ?? []).length > 0 ? 'ok' : 'not_found'
}

export async function markAllRead(admin: Admin, userId: string): Promise<number> {
  const { data, error } = await admin
    .from('player_notifications')
    .update({ read: true })
    .eq('player_id', userId)
    .eq('read', false)
    .select('id')
  if (error) {
    console.error('[inbox] markAllRead failed', { code: error.code, message: error.message })
    throw new Error('could not mark notifications read')
  }
  return (data ?? []).length
}

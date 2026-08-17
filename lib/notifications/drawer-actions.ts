'use server'
import { createClient } from '@/lib/supabase/server'
import type { NotificationItem } from '@/lib/nav/session'

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = createClient()
  await supabase.from('player_notifications').update({ read: true }).eq('id', id)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('player_notifications').update({ read: true }).eq('player_id', user.id).eq('read', false)
}

export async function loadMoreNotifications(offset: number): Promise<NotificationItem[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('player_notifications')
    .select('id, type, title, body, link, read, created_at')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + 19)
  return (data ?? []).map((n) => ({
    id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.created_at,
  }))
}

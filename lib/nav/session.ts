import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

export interface NavSession {
  isLoggedIn: boolean
  isStaff: boolean
  id: string | null
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  unreadNotificationCount: number
  recentNotifications: NotificationItem[]
}

const LOGGED_OUT: NavSession = {
  isLoggedIn: false,
  isStaff: false,
  id: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  unreadNotificationCount: 0,
  recentNotifications: [],
}

export async function getNavSession(): Promise<NavSession> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return LOGGED_OUT

  const [{ data: profile }, staff, { count: unreadCount }, { data: notifRows }] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', user.id).maybeSingle(),
    getStaffContext(),
    supabase
      .from('player_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', user.id)
      .eq('read', false),
    supabase
      .from('player_notifications')
      .select('id, type, title, body, link, read, created_at')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const recentNotifications: NotificationItem[] = (notifRows ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: n.created_at,
  }))

  return {
    isLoggedIn: true,
    isStaff: staff?.isStaff ?? false,
    id: user.id,
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    unreadNotificationCount: unreadCount ?? 0,
    recentNotifications,
  }
}

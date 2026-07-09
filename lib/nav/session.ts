import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'

export interface NavSession {
  isLoggedIn: boolean
  isStaff: boolean
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

const LOGGED_OUT: NavSession = {
  isLoggedIn: false,
  isStaff: false,
  username: null,
  displayName: null,
  avatarUrl: null,
}

export async function getNavSession(): Promise<NavSession> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return LOGGED_OUT

  const [{ data: profile }, staff] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', user.id).maybeSingle(),
    getStaffContext(),
  ])

  return {
    isLoggedIn: true,
    isStaff: staff?.isStaff ?? false,
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  }
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type StaffRole = 'admin' | 'moderator'

export interface StaffContext {
  userId: string
  email: string | null
  roles: StaffRole[]
  isStaff: boolean
  isAdmin: boolean
}

const STAFF_ROLES: readonly string[] = ['admin', 'moderator']

// Distinct returns so callers never need a second auth check:
//   null                          -> not authenticated
//   { isStaff: false, roles: [] } -> authenticated, no staff role
//   { isStaff: true, ... }        -> authenticated staff
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  const roles = (roleRows ?? [])
    .map((r) => r.role)
    .filter((r): r is StaffRole => STAFF_ROLES.includes(r))

  return {
    userId: user.id,
    email: user.email ?? null,
    roles,
    isStaff: roles.length > 0,
    isAdmin: roles.includes('admin'),
  }
}

// Layout gate: any staff role may pass.
export async function requireStaff(): Promise<StaffContext> {
  const ctx = await getStaffContext()
  if (ctx === null) redirect('/login?next=/admin')
  if (!ctx.isStaff) redirect('/dashboard')
  return ctx
}

// Admin-only surfaces (e.g. financial actions). Auth + staff already handled by requireStaff.
export async function requireAdmin(): Promise<StaffContext> {
  const ctx = await requireStaff()
  if (!ctx.isAdmin) redirect('/admin')
  return ctx
}

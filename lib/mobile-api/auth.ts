import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StaffRole } from '@/lib/admin/auth'
import { Errors } from './errors'

const STAFF_ROLES: readonly string[] = ['admin', 'moderator']

export interface MobileCtx {
  userId: string
  email: string | null
  accessToken: string
  roles: StaffRole[]
  isStaff: boolean
  isAdmin: boolean
  /** RLS-scoped as the caller — use for reads RLS already scopes correctly. */
  userClient: SupabaseClient<Database>
  /** Service role. Only where the equivalent web code already uses it; id from ctx.userId, never the body. */
  admin: ReturnType<typeof createAdminClient>
}

export function readBearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

export async function authenticate(req: Request): Promise<MobileCtx> {
  const token = readBearer(req)
  if (!token) throw Errors.unauthorized()

  const userClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  )

  // Network-verified — the handler's own check is the security boundary.
  const { data, error } = await userClient.auth.getUser(token)
  if (error || !data.user) throw Errors.unauthorized()

  const { data: roleRows } = await userClient.from('user_roles').select('role').eq('user_id', data.user.id)
  const roles = (roleRows ?? [])
    .map((r) => r.role)
    .filter((r): r is StaffRole => STAFF_ROLES.includes(r))

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    accessToken: token,
    roles,
    isStaff: roles.length > 0,
    isAdmin: roles.includes('admin'),
    userClient,
    admin: createAdminClient(),
  }
}

export async function optionalAuth(req: Request): Promise<MobileCtx | null> {
  if (!readBearer(req)) return null
  try {
    return await authenticate(req)
  } catch {
    return null
  }
}

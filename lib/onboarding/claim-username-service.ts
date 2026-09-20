import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { usernameSchema } from '@/lib/auth/schema'
import { isUsernameRetired } from '@/lib/auth/signup-blocks'

export type ClaimUsernameErrorCode =
  | 'username_too_short'
  | 'username_too_long'
  | 'username_charset'
  | 'username_taken'
  | 'username_save_failed'

export type ClaimUsernameServiceResult =
  | { ok: true; username: string }
  | { ok: false; errorCode: ClaimUsernameErrorCode }

// Extracted from lib/onboarding/actions.ts's claimUsername() — the Server
// Action and POST /onboarding/username both call this.
export async function performClaimUsername(
  supabase: SupabaseClient<Database>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  rawUsername: string,
): Promise<ClaimUsernameServiceResult> {
  const parsed = usernameSchema.safeParse(rawUsername)
  if (!parsed.success) {
    return { ok: false, errorCode: parsed.error.issues[0].message as ClaimUsernameErrorCode }
  }

  const { data: existing } = await supabase.from('profiles').select('id').eq('username', parsed.data).maybeSingle()
  if (existing) return { ok: false, errorCode: 'username_taken' }

  // A retired handle is free in `profiles` — the tombstone holds
  // 'deleted_<id>' instead — so the uniqueness check above cannot see it.
  if (await isUsernameRetired(admin, parsed.data)) {
    return { ok: false, errorCode: 'username_taken' }
  }

  // profiles can only be written via the service role since the S2
  // lock-down (20260918200000_...sql).
  const { error } = await admin.from('profiles').update({ username: parsed.data, display_name: parsed.data }).eq('id', userId)
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, errorCode: 'username_taken' }
    return { ok: false, errorCode: 'username_save_failed' }
  }

  return { ok: true, username: parsed.data }
}

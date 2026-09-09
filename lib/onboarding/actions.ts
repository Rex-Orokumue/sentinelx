'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { usernameSchema } from '@/lib/auth/schema'
import { safeInternalPath } from './safe-path'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUsernameRetired } from '@/lib/auth/signup-blocks'

// Codes, translated by the onboarding form under `auth.errors` — same
// convention as lib/auth/actions.ts.
export type ClaimUsernameErrorCode =
  | 'username_too_short'
  | 'username_too_long'
  | 'username_charset'
  | 'username_taken'
  | 'username_save_failed'

export type ClaimUsernameState = { errorCode?: ClaimUsernameErrorCode } | undefined

export async function claimUsername(
  _prev: ClaimUsernameState,
  formData: FormData,
): Promise<ClaimUsernameState> {
  const parsed = usernameSchema.safeParse(formData.get('username'))
  // usernameSchema's messages are codes (see lib/auth/schema.ts).
  if (!parsed.success) {
    return { errorCode: parsed.error.issues[0].message as ClaimUsernameErrorCode }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', parsed.data)
    .maybeSingle()
  if (existing) return { errorCode: 'username_taken' }

  // A retired handle is free in `profiles` — the tombstone holds
  // 'deleted_<id>' instead — so the uniqueness check above cannot see it.
  // Without this, a deleted player's username would be claimable here even
  // though signup rejects it.
  if (await isUsernameRetired(createAdminClient(), parsed.data)) {
    return { errorCode: 'username_taken' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ username: parsed.data, display_name: parsed.data })
    .eq('id', user.id)
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { errorCode: 'username_taken' }
    }
    return { errorCode: 'username_save_failed' }
  }

  redirect(safeInternalPath(formData.get('next') as string | null, '/dashboard'))
}

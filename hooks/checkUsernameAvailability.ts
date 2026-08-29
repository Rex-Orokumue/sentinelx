import { createClient } from '@/lib/supabase/client'

export type AvailabilityResult = 'available' | 'taken' | 'unknown'

// This runs client-side, on every keystroke (debounced) — there is no Vercel
// function ceiling to kill it the way there is for a server request, so an
// unbounded call here can hang far longer than any server-side timeout. It
// used to have no bound and no error handling at all: a stalled or failing
// Supabase request left the caller stuck on "checking" indefinitely, which
// is what permanently disabled the signup/onboarding Continue button.
//
// 'unknown' is intentionally non-blocking, not an error state — the DB
// UNIQUE constraint (see lib/auth/actions.ts's signup(), which already
// "fails open" the same way on this exact query) is the real backstop, so a
// failed pre-check must never be allowed to block the user from proceeding.
const CHECK_TIMEOUT_MS = 4000

export async function checkUsernameAvailability(username: string): Promise<AvailabilityResult> {
  try {
    const supabase = createClient()
    const result = await Promise.race([
      supabase.from('profiles').select('id').eq('username', username).maybeSingle(),
      new Promise<'unresolved'>((resolve) => setTimeout(() => resolve('unresolved'), CHECK_TIMEOUT_MS)),
    ])
    if (result === 'unresolved') return 'unknown'
    return result.data ? 'taken' : 'available'
  } catch {
    return 'unknown'
  }
}

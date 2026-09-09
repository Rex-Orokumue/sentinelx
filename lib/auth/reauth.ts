import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

// Re-authentication helpers for actions that change who owns an account.
//
// The point of re-auth is that a live session is not enough: a borrowed or
// stolen session should not be able to move the account to someone else's
// inbox. Only the password proves that.

// Checks a password WITHOUT disturbing the caller's session. The request-scoped
// server client persists whatever it gets back into auth cookies, so verifying
// with it would quietly rotate the live session's tokens mid-request (and, on a
// failure, could leave the cookies half-written). A throwaway client with
// persistSession off validates the credentials and drops the result.
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error } = await client.auth.signInWithPassword({ email, password })
  return !error
}

// A Google-only account has no password to re-enter. Supabase lists the linked
// providers on the user; 'email' is the one that carries a password.
//
// Missing identities fails OPEN on purpose. verifyPassword is the real gate, so
// a wrong guess here costs nothing on the security side — but guessing "no
// password" would send someone who has one off to set another, which is a
// dead end they cannot argue with.
export function hasPasswordIdentity(user: Pick<User, 'identities'>): boolean {
  if (!user.identities) return true
  return user.identities.some((identity) => identity.provider === 'email')
}

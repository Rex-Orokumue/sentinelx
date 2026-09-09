// Decides where /auth/confirm sends the user after verifyOtp establishes a
// session. Supabase sets `type` in email links: `recovery` for password
// resets, `signup`/others for email confirmation. Recovery MUST land on the
// reset-password form, not the dashboard.
export function resolveCallbackRedirect(params: {
  type: string | null
  next: string | null
}): string {
  if (params.type === 'recovery') return '/reset-password'
  // A confirmed email change always lands back on settings, whatever `next`
  // says, so the new address is visible on the row that was pending a moment
  // ago. The query flag is what turns the confirmation banner on.
  if (params.type === 'email_change') return '/dashboard/settings?email=changed'
  const next = params.next
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/dashboard'
}

// Where the OAuth callback sends someone when the code exchange fails.
//
// A failed sign-in belongs on /login. A failed *link* does not: that person is
// already signed in and merely tried to attach Google from their settings, so
// bouncing them to a login page with an auth error reads as "you have been
// signed out". The usual cause is mundane — the Google account is already
// attached to a different SentinelX user.
export function resolveOAuthFailureRedirect(params: { intent: string | null }): string {
  if (params.intent === 'link') return '/dashboard/settings?linked=error'
  return '/login?error=auth'
}

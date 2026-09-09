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

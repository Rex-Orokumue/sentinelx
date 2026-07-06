// Decides where /auth/confirm sends the user after verifyOtp establishes a
// session. Supabase sets `type` in email links: `recovery` for password
// resets, `signup`/others for email confirmation. Recovery MUST land on the
// reset-password form, not the dashboard.
export function resolveCallbackRedirect(params: {
  type: string | null
  next: string | null
}): string {
  if (params.type === 'recovery') return '/reset-password'
  const next = params.next
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return '/dashboard'
}

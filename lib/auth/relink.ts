// GoTrue links an OAuth identity to an existing account automatically when the
// provider hands back a VERIFIED email that matches that account's confirmed
// address. So unlinking Google is only durable while the two addresses differ:
// with the same address, the next Google sign-in silently restores the link
// (observed 2026-09-09 — an identity deleted at 14:06 was recreated at 14:23).
//
// Unlink and change-email therefore only close the door together. This is the
// check that says so at the point of unlinking.
export function willGoogleRelink(params: {
  accountEmail: string | null
  googleEmail: string | null
}): boolean {
  const account = params.accountEmail?.trim().toLowerCase()
  const google = params.googleEmail?.trim().toLowerCase()
  if (!account || !google) return false
  return account === google
}

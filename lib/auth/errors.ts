// Username uniqueness is enforced by the `profiles.username` UNIQUE constraint.
// The signup action pre-checks availability against `profiles` (the primary,
// precise path), so this mapper only needs to catch the rare race where two
// signups grab the same username between the check and the trigger INSERT.
//
// In that race GoTrue may expose the Postgres unique-violation as a structured
// `code` (23505) or a message mentioning the duplicate key / unique constraint.
// We deliberately do NOT treat GoTrue's generic "Database error saving new user"
// wrapper as "username taken": that string is emitted for ANY trigger/DB failure
// and mislabeling it hides the real cause. Unmatched errors fall through to the
// generic message and are logged server-side by the caller.
export function isUsernameTakenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === '23505') return true
  const msg = (e.message ?? '').toLowerCase()
  return msg.includes('duplicate key') || msg.includes('unique constraint')
}

export function mapSignupError(error: unknown): string {
  if (isUsernameTakenError(error)) {
    return 'That username is taken — go back and pick another.'
  }
  return 'Something went wrong creating your account. Please try again.'
}

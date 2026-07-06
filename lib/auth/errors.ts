// The profiles trigger raises a Postgres unique-violation (23505) when a
// username is already taken during signUp. GoTrue may expose it as a
// structured `code`, or wrap it in a "Database error saving new user"
// message. The only DB constraint the trigger can violate is the username
// UNIQUE index, so we treat any of these signals as "username taken".
export function isUsernameTakenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === '23505') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('database error saving new user') ||
    msg.includes('duplicate key') ||
    msg.includes('unique constraint')
  )
}

export function mapSignupError(error: unknown): string {
  if (isUsernameTakenError(error)) {
    return 'That username is taken — go back and pick another.'
  }
  return 'Something went wrong creating your account. Please try again.'
}

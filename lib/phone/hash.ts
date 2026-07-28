import { createHash, timingSafeEqual } from 'crypto'

// Codes are 6-digit, short-lived (10 min), and rate/attempt-limited
// (lib/phone/actions.ts) — a plain sha256 digest is proportionate; this
// isn't a password store. timingSafeEqual avoids leaking a match via
// response-time comparison.
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export function codeMatches(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashCode(code))
  const expected = Buffer.from(hash)
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

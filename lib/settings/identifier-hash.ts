import { createHash } from 'crypto'

// One-way and peppered. The pepper is a server-side secret, present so
// banned_identifiers cannot be reversed by hashing a list of common email
// addresses — without it the table would effectively be a plaintext blocklist.
//
// Normalised so a match holds however the user typed it; otherwise the block
// is sidestepped by capitalising a letter.
export function hashIdentifier(value: string, pepper: string): string {
  return createHash('sha256').update(value.trim().toLowerCase() + pepper).digest('hex')
}

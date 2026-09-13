// Squad-lifecycle pure logic — invite codes and admin-arranged auto-grouping.
// No IO here; everything DB-facing (uniqueness, actual squad rows) lives in
// squad-membership.ts and bracket-admin-actions.ts.

// Excludes 0/O/1/I/L — a code shared over WhatsApp gets retyped by hand, and
// those pairs are the ones people misread.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const INVITE_CODE_LENGTH = 8

export function generateInviteCode(rng: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[Math.floor(rng() * INVITE_CODE_ALPHABET.length)]
  }
  return code
}

export function isValidInviteCodeShape(code: string): boolean {
  return new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`).test(code)
}

// Fisher-Yates, then chop into fixed-size chunks. Whatever doesn't fill a
// final chunk is leftover, never forced into an undersized squad — a team
// squad has no size range to grow into (spec §5.2), unlike a BR group.
export function autoGroupIntoSquads(
  playerIds: string[],
  teamSize: number,
  rng: () => number = Math.random,
): { groups: string[][]; leftover: string[] } {
  if (teamSize <= 0) return { groups: [], leftover: [...playerIds] }
  const shuffled = [...playerIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const groups: string[][] = []
  let i = 0
  for (; i + teamSize <= shuffled.length; i += teamSize) groups.push(shuffled.slice(i, i + teamSize))
  return { groups, leftover: shuffled.slice(i) }
}

export function squadNameFor(n: number): string {
  return `Squad ${n}`
}

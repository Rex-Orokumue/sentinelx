// The display name for a match's opponent slot. A real opponent shows their
// own name; an empty slot means either a bye (the other player auto-advances,
// there will never be an opponent) or a knockout pairing that hasn't been
// drawn yet. Only the first case is a "BYE" — everything else is still "TBD".
export function opponentDisplayName(
  name: string | null | undefined,
  status: string,
): string {
  if (name) return name
  return status === 'bye' ? 'BYE' : 'TBD'
}

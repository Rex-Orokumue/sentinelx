export type FriendRow = { requester_id: string; recipient_id: string; status: string }

// The de-duplicated set of players to tell when `authorId` posts a status:
// the other participant of every ACCEPTED friendship that involves them.
// Direction-agnostic (either side may have sent the request) and self-safe.
export function friendStatusRecipients(input: { friendRows: FriendRow[]; authorId: string }): string[] {
  const out = new Set<string>()
  for (const row of input.friendRows) {
    if (row.status !== 'accepted') continue
    const involvesAuthor = row.requester_id === input.authorId || row.recipient_id === input.authorId
    if (!involvesAuthor) continue
    const other = row.requester_id === input.authorId ? row.recipient_id : row.requester_id
    if (other !== input.authorId) out.add(other)
  }
  return Array.from(out)
}

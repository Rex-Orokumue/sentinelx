export type UnreadInput = { senderId: string; readAt: string | null }

// "read_at IS NULL AND sender_id <> me" — the spec's exact definition.
export function unreadCount(messages: UnreadInput[], viewerId: string): number {
  return messages.filter((m) => m.senderId !== viewerId && m.readAt === null).length
}

export type BlockRow = { blockerId: string; blockedId: string }

// Symmetric in effect: if EITHER party blocked the other, neither can send.
// The DB's dm_can_message() enforces the same; this is the client twin.
export function isBlockedBetween(blocks: BlockRow[], x: string, y: string): boolean {
  return blocks.some(
    (b) =>
      (b.blockerId === x && b.blockedId === y) ||
      (b.blockerId === y && b.blockedId === x),
  )
}

// Admin signal: of the threads this player started, how many since the cutoff.
// A high number next to a report is a mass-contact pattern.
export function countNewContactsSince(createdAts: string[], sinceIso: string): number {
  return createdAts.filter((t) => t >= sinceIso).length
}

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

// 10-minute "change your mind" window for editing/unsending your own
// message. Enforced here for the UI (disable the controls after 10 min) AND
// server-side in the sender_edit_or_unsend RLS policy — same client/DB
// relationship as isBlockedBetween is to dm_can_message().
export function canEditOrUnsend(createdAtIso: string, nowIso: string): boolean {
  const createdAt = new Date(createdAtIso).getTime()
  const now = new Date(nowIso).getTime()
  return now - createdAt <= 10 * 60 * 1000
}

export type MessageContentInput = {
  body: string | null
  imageUrl: string | null
  deletedAt: string | null
  stickerId?: string | null
  audioUrl?: string | null
}
export type ParticipantContent = {
  body: string | null
  imageUrl: string | null
  removed: boolean
  stickerId: string | null
  audioUrl: string | null
}

// What a PARTICIPANT sees. Staff bypass this entirely — admin-query.ts reads
// body/image_url/sticker_id/audio_url directly and never calls this.
export function resolveParticipantContent(input: MessageContentInput): ParticipantContent {
  if (input.deletedAt) return { body: null, imageUrl: null, removed: true, stickerId: null, audioUrl: null }
  return {
    body: input.body,
    imageUrl: input.imageUrl,
    removed: false,
    stickerId: input.stickerId ?? null,
    audioUrl: input.audioUrl ?? null,
  }
}

// Forwarding needs the original content to still exist — an unsent message
// has none left to copy. No time limit, unlike edit/unsend: forwarding is
// allowed on anyone's message, any time, as long as it's still visible.
export function canForward(deletedAt: string | null): boolean {
  return !deletedAt
}

import type { ConversationMessage } from './query'

// WhatsApp-style optimistic sending: a message appears the instant you hit
// send, carrying a clock icon (MessageBubble renders this from `status`)
// until the server confirms it — then a tick, or a tappable "failed, retry"
// mark if it didn't go through. `retry` is a plain closure (not sent-related
// state) so MessageBubble can just call it back; each caller of
// buildOptimisticMessage attaches its own retry when it later marks the
// entry 'failed'.
export type LocalStatus = 'pending' | 'sent' | 'failed'
// `discard` is only ever set alongside a 'failed' status — a message stuck on
// a local id has nothing server-side to unsend, so this just drops it from
// local state (see MessageBubble's failed-tick button).
export type DisplayMessage = ConversationMessage & { status?: LocalStatus; retry?: () => void; discard?: () => void }

// Local ids never collide with a real message id (uuid), so `id === real id`
// checks elsewhere (the realtime dedupe, admin/report flows) can't
// accidentally match one. Kept as a plain prefix check (isLocalId) rather
// than a regex — cheap, and the exact id format is an implementation detail.
export function newLocalId(): string {
  return `local:${crypto.randomUUID()}`
}
export function isLocalId(id: string): boolean {
  return id.startsWith('local:')
}

// The "Replying to" quote shown on a message about to be sent — mirrors
// what the server's resolveReply (lib/messages/query.ts) computes for a
// message already in the thread, but built from data the client already has
// so it doesn't need a round trip to preview correctly.
export function buildReplyPreview(
  target: ConversationMessage,
  viewerId: string,
  otherName: string,
  previewText: string,
): NonNullable<ConversationMessage['replyTo']> {
  return {
    id: target.id,
    senderName: target.senderId === viewerId ? 'You' : otherName,
    body: previewText,
    removed: false,
  }
}

// A freshly composed message, rendered before the server has seen it.
// Exactly one of body/imageUrl/stickerId/audioUrl is expected to be set,
// mirroring sendMessage's own "at least one content field" rule — this
// constructor doesn't enforce that itself, callers already know which kind
// of message they're building.
export function buildOptimisticMessage(input: {
  id: string
  viewerId: string
  body?: string | null
  imageUrl?: string | null
  stickerId?: string | null
  audioUrl?: string | null
  audioDurationSeconds?: number | null
  replyTo?: ConversationMessage['replyTo']
}): DisplayMessage {
  return {
    id: input.id,
    senderId: input.viewerId,
    body: input.body ?? null,
    imageUrl: input.imageUrl ?? null,
    stickerId: input.stickerId ?? null,
    audioUrl: input.audioUrl ?? null,
    audioDurationSeconds: input.audioDurationSeconds ?? null,
    forwarded: false,
    createdAt: new Date().toISOString(),
    readAt: null,
    editedAt: null,
    deletedAt: null,
    replyTo: input.replyTo ?? null,
    status: 'pending',
  }
}

// Reconciles local optimistic entries against a fresh server-fetched
// message list (Conversation's `detail.messages` prop, after a
// router.refresh()). A 'sent' local entry is dropped unconditionally — the
// server list is now authoritative and already contains its real copy (by
// the time a caller sets status to 'sent' it has also swapped the entry's
// id to the real one, so there's nothing left for this merge to preserve).
// 'pending'/'failed' entries have no server-side copy yet, so they survive.
export function mergeLocalMessages(serverMessages: ConversationMessage[], previous: DisplayMessage[]): DisplayMessage[] {
  const unresolved = previous.filter((m) => m.status === 'pending' || m.status === 'failed')
  return [...serverMessages, ...unresolved]
}

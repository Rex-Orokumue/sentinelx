import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { messageBodySchema, reportReasonSchema, audioDurationSchema } from './schema'
import { canEditOrUnsend, canForward } from './predicates'
import { isValidStickerId, stickerById } from './stickers'
import { notifyBoth } from '@/lib/notifications/send'
import { notifyInAppOf } from '@/lib/notifications/inbox'
import { isOwnMediaPath } from './media-paths'

// Every DM mutation lives here, taking an explicit context, so the Server Actions (web) and the
// /api/mobile/v1 endpoints share ONE implementation (mobile API conventions §7.1).
export interface MessageCtx {
  /** RLS-scoped as the caller. */
  supabase: SupabaseClient<Database>
  /** Service role, only where the original web action already used it. */
  admin: ReturnType<typeof createAdminClient>
  userId: string
}

export type MessageErrorCode =
  | 'not_found'
  | 'validation'
  | 'blocked_by_me'
  | 'blocked'
  | 'messaging_restricted'
  | 'edit_window_closed'
  | 'not_forwardable'
  | 'send_failed'
  | 'action_failed'
  | 'request_pending_limit'
  | 'request_media_not_allowed'

export type Failure = { ok: false; errorCode: MessageErrorCode; message: string }
const fail = (errorCode: MessageErrorCode, message: string): Failure => ({ ok: false, errorCode, message })

export type SendInput = {
  threadId?: string
  recipientId?: string
  body?: string
  imageUrl?: string
  replyToId?: string
  stickerId?: string
  audioUrl?: string
  audioDurationSeconds?: number
  forwarded?: boolean
}

export type RequestState = 'pending' | 'accepted' | 'declined'
// Anything unknown (including a row from before the column existed) reads as accepted: grandfathered threads are open.
const asState = (v: unknown): RequestState => (v === 'pending' || v === 'declined' ? v : 'accepted')

type ResolvedThread = { ok: true; threadId: string; requestState: RequestState; createdBy: string }

// Existing thread id, or a new one. Service-role — dm_threads has no client INSERT policy. No rate limit
// (decision 2026-09-09); abuse is handled by the admin mute + the report-queue signal.
// A NEW thread starts 'pending' unless dm_is_exempt (staff sender or accepted friends).
async function resolveOrCreateThread(ctx: MessageCtx, viewerId: string, otherId: string): Promise<ResolvedThread | Failure> {
  const admin = ctx.admin
  const { playerA, playerB } = orderedPair(viewerId, otherId)
  const lookup = () =>
    admin
      .from('dm_threads')
      .select('id, request_state, created_by')
      .eq('player_a', playerA)
      .eq('player_b', playerB)
      .maybeSingle()
  const existingOf = (row: { id: string; request_state?: string | null; created_by?: string | null }): ResolvedThread => ({
    ok: true,
    threadId: row.id,
    requestState: asState(row.request_state),
    createdBy: row.created_by ?? viewerId,
  })

  const { data: existing } = await lookup()
  if (existing) return existingOf(existing)

  const { data: exempt } = await admin.rpc('dm_is_exempt', { p_sender: viewerId, p_other: otherId })
  const requestState: RequestState = exempt ? 'accepted' : 'pending'
  const { data: created, error } = await admin
    .from('dm_threads')
    .insert({ player_a: playerA, player_b: playerB, created_by: viewerId, request_state: requestState })
    .select('id')
    .single()
  if (error?.code === '23505') {
    const { data: raced } = await lookup()
    if (raced) return existingOf(raced)
  }
  if (error || !created) return fail('action_failed', 'Could not start this conversation. Please try again.')
  return { ok: true, threadId: created.id, requestState, createdBy: viewerId }
}

export async function startConversation(
  ctx: MessageCtx,
  otherId: string,
): Promise<{ ok: true; threadId: string; requestState: RequestState } | Failure> {
  if (!otherId || otherId === ctx.userId) return fail('validation', 'Pick someone to message.')
  const res = await resolveOrCreateThread(ctx, ctx.userId, otherId)
  return res.ok ? { ok: true, threadId: res.threadId, requestState: res.requestState } : res
}

// The trusted core. forwardMessageCore reuses it with a path read from the database row (the original
// sender's folder), so it must NOT check media-path ownership — that rule lives in sendClientMessage.
export async function sendMessageCore(
  ctx: MessageCtx,
  input: SendInput,
): Promise<{ ok: true; threadId: string; messageId: string; createdAt: string } | Failure> {
  const { supabase, admin, userId } = ctx

  const rawBody = (input.body ?? '').trim()
  const imageUrl = input.imageUrl?.trim() || null
  const audioUrl = input.audioUrl?.trim() || null
  let stickerId: string | null = null
  if (input.stickerId) {
    if (!isValidStickerId(input.stickerId)) return fail('validation', 'Unknown sticker.')
    stickerId = input.stickerId
  }
  let audioDurationSeconds: number | null = null
  if (audioUrl) {
    const parsedDuration = audioDurationSchema.safeParse(input.audioDurationSeconds)
    if (!parsedDuration.success) return fail('validation', 'Invalid voice note.')
    audioDurationSeconds = parsedDuration.data
  }
  if (!rawBody && !imageUrl && !stickerId && !audioUrl) {
    return fail('validation', 'Type a message, add a photo, or send a sticker.')
  }
  let body: string | null = null
  if (rawBody) {
    const parsed = messageBodySchema.safeParse(rawBody)
    if (!parsed.success) return fail('validation', parsed.error.issues[0].message)
    body = parsed.data
  }

  let threadId = input.threadId
  let otherId: string
  let requestState: RequestState = 'accepted'
  let createdBy: string | null = null

  if (threadId) {
    const { data: t } = await admin
      .from('dm_threads')
      .select('player_a, player_b, request_state, created_by')
      .eq('id', threadId)
      .maybeSingle()
    if (!t || (t.player_a !== userId && t.player_b !== userId)) return fail('not_found', 'Conversation not found.')
    otherId = t.player_a === userId ? t.player_b : t.player_a
    requestState = asState(t.request_state)
    createdBy = t.created_by ?? null
  } else {
    if (!input.recipientId || input.recipientId === userId) return fail('validation', 'Pick someone to message.')
    otherId = input.recipientId
    const resolved = await resolveOrCreateThread(ctx, userId, otherId)
    if (!resolved.ok) return resolved
    threadId = resolved.threadId
    requestState = resolved.requestState
    createdBy = resolved.createdBy
  }

  // Friendly pre-checks (RLS dm_can_message() is the real guard).
  const [{ data: blockRows }, { data: muted }] = await Promise.all([
    admin
      .from('dm_blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`,
      ),
    admin.from('dm_muted_players').select('player_id').eq('player_id', userId).maybeSingle(),
  ])
  if (muted) {
    return fail('messaging_restricted', 'Your messaging is currently restricted. Contact support if you think this is a mistake.')
  }
  if (blockRows && blockRows.length > 0) {
    const iBlocked = blockRows.some((b) => b.blocker_id === userId)
    return iBlocked
      ? fail('blocked_by_me', 'Unblock this player to message them.')
      : fail('blocked', 'You can no longer message this player.')
  }

  // The initiator of a declined request is told exactly what a block would say, so a decline is not its own signal.
  // (dm_can_message in the database is the real guard; this is the friendly pre-check.)
  if (requestState === 'declined' && createdBy === userId) {
    return fail('blocked', 'You can no longer message this player.')
  }

  // A reply target must belong to THIS thread — a client could otherwise pass an arbitrary message id from
  // a thread the sender has no business quoting.
  let replyToId: string | null = null
  if (input.replyToId) {
    const { data: target } = await admin
      .from('dm_messages')
      .select('id')
      .eq('id', input.replyToId)
      .eq('thread_id', threadId)
      .maybeSingle()
    replyToId = target?.id ?? null
  }

  // Insert via the SESSION client so the RLS sender-insert policy applies (defence in depth) —
  // dm_can_message() re-checks block + mute server-side. Returns the new row's id so the caller can swap it
  // into an optimistic local entry.
  const { data: inserted, error: insErr } = await supabase
    .from('dm_messages')
    .insert({
      thread_id: threadId,
      sender_id: userId,
      body,
      image_url: imageUrl,
      reply_to_id: replyToId,
      sticker_id: stickerId,
      audio_url: audioUrl,
      audio_duration_seconds: audioDurationSeconds,
      forwarded: input.forwarded ?? false,
    })
    .select('id, created_at')
    .single()
  if (insErr) {
    // The request gate lives in the database (triggers raise these); translate for the person sending.
    const reason = insErr.message ?? ''
    if (reason.includes('request_pending_limit')) return fail('request_pending_limit', 'Wait for a reply before sending more.')
    if (reason.includes('request_media_not_allowed')) {
      return fail('request_media_not_allowed', 'Only text can be sent until they accept.')
    }
    console.error('[sendMessage] insert failed', { userId, threadId, code: insErr.code, message: insErr.message })
    return fail('send_failed', 'Could not send your message. Please try again.')
  }

  await admin.from('dm_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)

  const { data: me } = await admin.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
  const fromName = me?.display_name ?? me?.username ?? 'Someone'
  // notifyBoth renders bell + push from one NotificationInput (lib/notifications/copy.ts).
  const kind: 'text' | 'sticker' | 'voice' | 'photo' = body ? 'text' : stickerId ? 'sticker' : audioUrl ? 'voice' : 'photo'
  const excerpt = body ? (body.length > 80 ? `${body.slice(0, 80)}…` : body) : undefined
  const emoji = stickerId ? (stickerById(stickerId)?.emoji ?? '🙂') : undefined
  const notification = { type: 'direct_message' as const, fromName, kind, excerpt, emoji }
  const link = `/messages/${threadId}`
  if (requestState === 'pending' && createdBy === userId) {
    // A request from a stranger still lands in the bell (so it is findable) but does not push: no stranger's message
    // on a lock screen until the thread is accepted. No new notification type is needed for this.
    void notifyInAppOf(otherId, notification, 'direct_message', link)
  } else {
    void notifyBoth(otherId, notification, 'direct_message', { link, data: { threadId } })
  }

  return { ok: true, threadId, messageId: inserted.id, createdAt: inserted.created_at ?? new Date().toISOString() }
}

// The ONLY entry point for content that came from a client: media paths must be the caller's own upload,
// and a client can never claim `forwarded`. Forwarding uses sendMessageCore directly (see its comment).
export async function sendClientMessage(
  ctx: MessageCtx,
  input: SendInput,
): Promise<{ ok: true; threadId: string; messageId: string; createdAt: string } | Failure> {
  if (input.imageUrl && !isOwnMediaPath(input.imageUrl.trim(), ctx.userId)) return fail('validation', 'Invalid attachment.')
  if (input.audioUrl && !isOwnMediaPath(input.audioUrl.trim(), ctx.userId)) return fail('validation', 'Invalid attachment.')
  return sendMessageCore(ctx, { ...input, forwarded: false })
}

// The recipient-mark-read RLS policy restricts the update to rows on threads the caller participates in, across all
// of their threads at once. Messages in a still-PENDING incoming request are excluded: reading a request must not
// tell the sender anything until it is accepted.
export async function markAllDelivered(ctx: MessageCtx): Promise<void> {
  try {
    const { data: pending } = await ctx.admin
      .from('dm_threads')
      .select('id')
      .eq('request_state', 'pending')
      .neq('created_by', ctx.userId)
      .or(`player_a.eq.${ctx.userId},player_b.eq.${ctx.userId}`)
    const pendingIds = (pending ?? []).map((r) => r.id)
    let update = ctx.supabase
      .from('dm_messages')
      .update({ delivered_at: new Date().toISOString() })
      .neq('sender_id', ctx.userId)
      .is('delivered_at', null)
    if (pendingIds.length > 0) update = update.not('thread_id', 'in', `(${pendingIds.join(',')})`)
    await update
  } catch {
    // best-effort
  }
}

export async function markThreadRead(ctx: MessageCtx, threadId: string): Promise<void> {
  try {
    const { data: t } = await ctx.admin.from('dm_threads').select('request_state, created_by').eq('id', threadId).maybeSingle()
    const pendingIncoming = asState(t?.request_state) === 'pending' && !!t?.created_by && t.created_by !== ctx.userId
    if (!pendingIncoming) {
      // Reading implies delivered — stamping both covers the deep-link case (opening a thread straight from a
      // push notification) where the list-page realtime subscription that normally marks delivered_at never mounted.
      const now = new Date().toISOString()
      await ctx.supabase
        .from('dm_messages')
        .update({ read_at: now, delivered_at: now })
        .eq('thread_id', threadId)
        .neq('sender_id', ctx.userId)
        .is('read_at', null)
    }
    await ctx.admin
      .from('player_notifications')
      .update({ read: true })
      .eq('player_id', ctx.userId)
      .eq('type', 'direct_message')
      .eq('link', `/messages/${threadId}`)
      .eq('read', false)
  } catch {
    // best-effort
  }
}

export async function blockPlayer(ctx: MessageCtx, otherId: string): Promise<{ ok: true } | Failure> {
  const { supabase, admin, userId } = ctx
  if (otherId === userId) return fail('validation', 'You cannot block yourself.')
  const { error } = await supabase
    .from('dm_blocks')
    .upsert({ blocker_id: userId, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
  if (error) return fail('action_failed', 'Could not block this player.')

  // A block severs any existing follow in either direction. The request-scoped client's RLS delete policy only
  // lets userId delete rows where THEY are follower_id, so the reverse direction needs the admin client.
  await admin
    .from('player_follows')
    .delete()
    .or(`and(follower_id.eq.${userId},following_id.eq.${otherId}),and(follower_id.eq.${otherId},following_id.eq.${userId})`)
  return { ok: true }
}

export async function unblockPlayer(ctx: MessageCtx, otherId: string): Promise<{ ok: true } | Failure> {
  const { error } = await ctx.supabase.from('dm_blocks').delete().eq('blocker_id', ctx.userId).eq('blocked_id', otherId)
  if (error) return fail('action_failed', 'Could not unblock this player.')
  return { ok: true }
}

export async function reportThread(
  ctx: MessageCtx,
  input: { threadId: string; messageId?: string; reason: string },
): Promise<{ ok: true } | Failure> {
  const { supabase, admin, userId } = ctx
  const parsed = reportReasonSchema.safeParse(input.reason)
  if (!parsed.success) return fail('validation', parsed.error.issues[0].message)

  const { data: t } = await admin
    .from('dm_threads')
    .select('player_a, player_b')
    .eq('id', input.threadId)
    .maybeSingle()
  if (!t || (t.player_a !== userId && t.player_b !== userId)) return fail('not_found', 'Conversation not found.')
  const reportedId = t.player_a === userId ? t.player_b : t.player_a

  const { error } = await supabase.from('dm_reports').insert({
    reporter_id: userId,
    reported_id: reportedId,
    thread_id: input.threadId,
    message_id: input.messageId ?? null,
    reason: parsed.data,
  })
  if (error) return fail('action_failed', 'Could not send this report. Please try again.')
  return { ok: true }
}

export async function editMessageCore(
  ctx: MessageCtx,
  input: { messageId: string; body: string },
): Promise<{ ok: true; threadId: string } | Failure> {
  const { supabase, admin, userId } = ctx
  const parsed = messageBodySchema.safeParse(input.body)
  if (!parsed.success) return fail('validation', parsed.error.issues[0].message)

  const { data: existing } = await admin
    .from('dm_messages')
    .select('id, thread_id, sender_id, body, image_url, created_at')
    .eq('id', input.messageId)
    .maybeSingle()
  if (!existing || existing.sender_id !== userId) return fail('not_found', 'Message not found.')
  if (!canEditOrUnsend(existing.created_at, new Date().toISOString())) {
    return fail('edit_window_closed', 'This message can only be edited within 10 minutes of sending.')
  }

  // dm_message_edits has no participant write policy — service-role only.
  const { error: histErr } = await admin.from('dm_message_edits').insert({
    message_id: existing.id,
    body_before: existing.body,
    image_url_before: existing.image_url,
  })
  if (histErr) return fail('action_failed', 'Could not edit this message. Please try again.')

  // Session client so the sender_edit_or_unsend RLS policy applies — defence in depth.
  const { error } = await supabase
    .from('dm_messages')
    .update({ body: parsed.data, edited_at: new Date().toISOString() })
    .eq('id', existing.id)
  if (error) return fail('action_failed', 'Could not edit this message. Please try again.')
  return { ok: true, threadId: existing.thread_id }
}

export async function unsendMessageCore(ctx: MessageCtx, messageId: string): Promise<{ ok: true; threadId: string } | Failure> {
  const { supabase, admin, userId } = ctx
  const { data: existing } = await admin
    .from('dm_messages')
    .select('id, thread_id, sender_id, created_at')
    .eq('id', messageId)
    .maybeSingle()
  if (!existing || existing.sender_id !== userId) return fail('not_found', 'Message not found.')
  if (!canEditOrUnsend(existing.created_at, new Date().toISOString())) {
    return fail('edit_window_closed', 'This message can only be unsent within 10 minutes of sending.')
  }

  const { error } = await supabase
    .from('dm_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', existing.id)
  if (error) return fail('action_failed', 'Could not unsend this message. Please try again.')
  return { ok: true, threadId: existing.thread_id }
}

// Copies a message's content into a new message in a different thread — no reference back to the original is
// stored (WhatsApp's no-attribution behaviour), just the `forwarded` flag. Any message the forwarder can see
// is forwardable, any time — no 10-minute window, since forwarding doesn't touch the original.
export async function forwardMessageCore(
  ctx: MessageCtx,
  input: { messageId: string; toThreadId: string },
): Promise<{ ok: true; messageId: string } | Failure> {
  const { admin, userId } = ctx
  const { data: source } = await admin
    .from('dm_messages')
    .select('thread_id, body, image_url, sticker_id, audio_url, audio_duration_seconds, deleted_at')
    .eq('id', input.messageId)
    .maybeSingle()
  if (!source) return fail('not_found', 'Message not found.')
  if (!canForward(source.deleted_at)) return fail('not_forwardable', 'This message can no longer be forwarded.')

  // The forwarder must be a participant of the SOURCE thread — otherwise anyone who ever learns a message id
  // could exfiltrate its content into a thread of their own choosing.
  const { data: sourceThread } = await admin
    .from('dm_threads')
    .select('player_a, player_b')
    .eq('id', source.thread_id)
    .maybeSingle()
  if (!sourceThread || (sourceThread.player_a !== userId && sourceThread.player_b !== userId)) {
    return fail('not_found', 'Message not found.')
  }

  // Reuses the core send for the block/mute pre-checks, the RLS-guarded insert, the thread bump and the
  // recipient notification — a forward is just a send whose content came from another message.
  const res = await sendMessageCore(ctx, {
    threadId: input.toThreadId,
    body: source.body ?? undefined,
    imageUrl: source.image_url ?? undefined,
    stickerId: source.sticker_id ?? undefined,
    audioUrl: source.audio_url ?? undefined,
    audioDurationSeconds: source.audio_duration_seconds ?? undefined,
    forwarded: true,
  })
  return res.ok ? { ok: true, messageId: res.messageId } : res
}

// Only the NON-creator participant may answer a request. Both are idempotent, and neither can undo the other: an
// accepted thread is never declined, and a declined one is reopened only by the recipient writing (database trigger).
async function loadRequestThread(ctx: MessageCtx, threadId: string) {
  const { data: t } = await ctx.admin
    .from('dm_threads')
    .select('player_a, player_b, created_by, request_state')
    .eq('id', threadId)
    .maybeSingle()
  if (!t || (t.player_a !== ctx.userId && t.player_b !== ctx.userId) || t.created_by === ctx.userId) return null
  return t
}

export async function acceptRequest(ctx: MessageCtx, threadId: string): Promise<{ ok: true } | Failure> {
  const t = await loadRequestThread(ctx, threadId)
  if (!t) return fail('not_found', 'Conversation not found.')
  if (asState(t.request_state) === 'accepted') return { ok: true }
  const { error } = await ctx.admin.from('dm_threads').update({ request_state: 'accepted' }).eq('id', threadId)
  if (error) return fail('action_failed', 'Could not accept this request. Please try again.')
  return { ok: true }
}

export async function declineRequest(ctx: MessageCtx, threadId: string): Promise<{ ok: true } | Failure> {
  const t = await loadRequestThread(ctx, threadId)
  if (!t) return fail('not_found', 'Conversation not found.')
  if (asState(t.request_state) !== 'pending') return { ok: true }
  const { error } = await ctx.admin
    .from('dm_threads')
    .update({ request_state: 'declined' })
    .eq('id', threadId)
    .eq('request_state', 'pending')
  if (error) return fail('action_failed', 'Could not decline this request. Please try again.')
  return { ok: true }
}

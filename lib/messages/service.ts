import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { messageBodySchema, reportReasonSchema, audioDurationSchema } from './schema'
import { canEditOrUnsend, canForward } from './predicates'
import { isValidStickerId, stickerById } from './stickers'
import { notifyBoth } from '@/lib/notifications/send'
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

// Existing thread id, or a new one. Service-role — dm_threads has no client INSERT policy. No rate limit
// (decision 2026-09-09); abuse is handled by the admin mute + the report-queue signal.
async function resolveOrCreateThread(
  ctx: MessageCtx,
  viewerId: string,
  otherId: string,
): Promise<{ ok: true; threadId: string } | Failure> {
  const admin = ctx.admin
  const { playerA, playerB } = orderedPair(viewerId, otherId)

  const { data: existing } = await admin
    .from('dm_threads')
    .select('id')
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .maybeSingle()
  if (existing) return { ok: true, threadId: existing.id }

  const { data: created, error } = await admin
    .from('dm_threads')
    .insert({ player_a: playerA, player_b: playerB, created_by: viewerId })
    .select('id')
    .single()
  if (error?.code === '23505') {
    const { data: raced } = await admin
      .from('dm_threads')
      .select('id')
      .eq('player_a', playerA)
      .eq('player_b', playerB)
      .maybeSingle()
    if (raced) return { ok: true, threadId: raced.id }
  }
  if (error || !created) return fail('action_failed', 'Could not start this conversation. Please try again.')
  return { ok: true, threadId: created.id }
}

export async function startConversation(ctx: MessageCtx, otherId: string): Promise<{ ok: true; threadId: string } | Failure> {
  if (!otherId || otherId === ctx.userId) return fail('validation', 'Pick someone to message.')
  return resolveOrCreateThread(ctx, ctx.userId, otherId)
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

  if (threadId) {
    const { data: t } = await admin
      .from('dm_threads')
      .select('player_a, player_b')
      .eq('id', threadId)
      .maybeSingle()
    if (!t || (t.player_a !== userId && t.player_b !== userId)) return fail('not_found', 'Conversation not found.')
    otherId = t.player_a === userId ? t.player_b : t.player_a
  } else {
    if (!input.recipientId || input.recipientId === userId) return fail('validation', 'Pick someone to message.')
    otherId = input.recipientId
    const resolved = await resolveOrCreateThread(ctx, userId, otherId)
    if (!resolved.ok) return resolved
    threadId = resolved.threadId
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
  void notifyBoth(otherId, { type: 'direct_message', fromName, kind, excerpt, emoji }, 'direct_message', {
    link: `/messages/${threadId}`,
    data: { threadId },
  })

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

// No thread_id filter needed: the recipient-mark-read RLS policy already restricts the update to rows on
// threads the caller is a participant of, across all of their threads at once.
export async function markAllDelivered(ctx: MessageCtx): Promise<void> {
  try {
    await ctx.supabase
      .from('dm_messages')
      .update({ delivered_at: new Date().toISOString() })
      .neq('sender_id', ctx.userId)
      .is('delivered_at', null)
  } catch {
    // best-effort
  }
}

export async function markThreadRead(ctx: MessageCtx, threadId: string): Promise<void> {
  try {
    // Reading implies delivered — stamping both covers the deep-link case (opening a thread straight from a
    // push notification) where the list-page realtime subscription that normally marks delivered_at never mounted.
    const now = new Date().toISOString()
    await ctx.supabase
      .from('dm_messages')
      .update({ read_at: now, delivered_at: now })
      .eq('thread_id', threadId)
      .neq('sender_id', ctx.userId)
      .is('read_at', null)
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

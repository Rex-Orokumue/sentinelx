'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { messageBodySchema, reportReasonSchema } from './schema'
import { notifyInApp } from '@/lib/notifications/inbox'

async function authed() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

// Existing thread id, or a new one. Service-role — dm_threads has no client
// INSERT policy. No rate limit (decision 2026-09-09); abuse is handled by the
// admin mute + the report-queue signal.
async function resolveOrCreateThread(
  viewerId: string,
  otherId: string,
): Promise<{ threadId: string } | { error: string }> {
  const admin = createAdminClient()
  const { playerA, playerB } = orderedPair(viewerId, otherId)

  const { data: existing } = await admin
    .from('dm_threads')
    .select('id')
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .maybeSingle()
  if (existing) return { threadId: existing.id }

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
    if (raced) return { threadId: raced.id }
  }
  if (error || !created) return { error: 'Could not start this conversation. Please try again.' }
  return { threadId: created.id }
}

export async function startConversation(otherId: string): Promise<{ threadId?: string; error?: string }> {
  const { userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  if (!otherId || otherId === userId) return { error: 'Pick someone to message.' }
  const res = await resolveOrCreateThread(userId, otherId)
  return 'error' in res ? res : { threadId: res.threadId }
}

export async function sendMessage(input: {
  threadId?: string
  recipientId?: string
  body?: string
  imageUrl?: string
}): Promise<{ threadId?: string; error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const rawBody = (input.body ?? '').trim()
  const imageUrl = input.imageUrl?.trim() || null
  if (!rawBody && !imageUrl) return { error: 'Type a message or add a photo.' }
  let body: string | null = null
  if (rawBody) {
    const parsed = messageBodySchema.safeParse(rawBody)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    body = parsed.data
  }

  let threadId = input.threadId
  let otherId: string
  const admin = createAdminClient()

  if (threadId) {
    const { data: t } = await admin
      .from('dm_threads')
      .select('player_a, player_b')
      .eq('id', threadId)
      .maybeSingle()
    if (!t || (t.player_a !== userId && t.player_b !== userId)) return { error: 'Conversation not found.' }
    otherId = t.player_a === userId ? t.player_b : t.player_a
  } else {
    if (!input.recipientId || input.recipientId === userId) return { error: 'Pick someone to message.' }
    otherId = input.recipientId
    const resolved = await resolveOrCreateThread(userId, otherId)
    if ('error' in resolved) return resolved
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
  if (muted) return { error: 'Your messaging is currently restricted. Contact support if you think this is a mistake.' }
  if (blockRows && blockRows.length > 0) {
    const iBlocked = blockRows.some((b) => b.blocker_id === userId)
    return { error: iBlocked ? 'Unblock this player to message them.' : 'You can no longer message this player.' }
  }

  // Insert via the SESSION client so the RLS sender-insert policy applies (defence
  // in depth) — dm_can_message() re-checks block + mute server-side.
  const { error: insErr } = await supabase
    .from('dm_messages')
    .insert({ thread_id: threadId, sender_id: userId, body, image_url: imageUrl })
  if (insErr) {
    console.error('[sendMessage] insert failed', { userId, threadId, code: insErr.code, message: insErr.message })
    return { error: 'Could not send your message. Please try again.' }
  }

  await admin.from('dm_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId)

  const { data: me } = await admin.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
  const fromName = me?.display_name ?? me?.username ?? 'Someone'
  const preview = body ? (body.length > 80 ? `${body.slice(0, 80)}…` : body) : '📷 Photo'
  void notifyInApp({
    playerId: otherId,
    type: 'direct_message',
    title: `New message from ${fromName}`,
    body: preview,
    link: `/messages/${threadId}`,
  })

  revalidatePath('/messages')
  revalidatePath(`/messages/${threadId}`)
  return { threadId }
}

export async function markThreadRead(threadId: string): Promise<void> {
  try {
    const { supabase, userId } = await authed()
    if (!userId) return
    await supabase
      .from('dm_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .neq('sender_id', userId)
      .is('read_at', null)
    const admin = createAdminClient()
    await admin
      .from('player_notifications')
      .update({ read: true })
      .eq('player_id', userId)
      .eq('type', 'direct_message')
      .eq('link', `/messages/${threadId}`)
      .eq('read', false)
  } catch {
    // best-effort
  }
}

export async function blockUser(otherId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  if (otherId === userId) return { error: 'You cannot block yourself.' }
  const { error } = await supabase
    .from('dm_blocks')
    .upsert({ blocker_id: userId, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
  if (error) return { error: 'Could not block this player.' }
  revalidatePath('/messages')
  return {}
}

export async function unblockUser(otherId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const { error } = await supabase.from('dm_blocks').delete().eq('blocker_id', userId).eq('blocked_id', otherId)
  if (error) return { error: 'Could not unblock this player.' }
  revalidatePath('/messages')
  return {}
}

export async function reportConversation(input: {
  threadId: string
  messageId?: string
  reason: string
}): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }

  const parsed = reportReasonSchema.safeParse(input.reason)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('dm_threads')
    .select('player_a, player_b')
    .eq('id', input.threadId)
    .maybeSingle()
  if (!t || (t.player_a !== userId && t.player_b !== userId)) return { error: 'Conversation not found.' }
  const reportedId = t.player_a === userId ? t.player_b : t.player_a

  const { error } = await supabase.from('dm_reports').insert({
    reporter_id: userId,
    reported_id: reportedId,
    thread_id: input.threadId,
    message_id: input.messageId ?? null,
    reason: parsed.data,
  })
  if (error) return { error: 'Could not send this report. Please try again.' }
  return {}
}

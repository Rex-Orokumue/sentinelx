import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { unreadCount, isBlockedBetween, resolveParticipantContent, type BlockRow } from './predicates'
import { stickerById } from './stickers'

const PROFILE = 'id, username, display_name, avatar_url'
type ProfileRow = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }

async function signPaths(bucket: 'dm-images' | 'dm-audio', paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const admin = createAdminClient()
  await Promise.all(
    paths.map(async (p) => {
      const { data } = await admin.storage.from(bucket).createSignedUrl(p, 3600)
      if (data?.signedUrl) out.set(p, data.signedUrl)
    }),
  )
  return out
}

export type ThreadSummary = {
  threadId: string
  otherId: string
  otherName: string
  otherUsername: string | null
  otherAvatarUrl: string | null
  lastMessage: string | null
  lastWasImage: boolean
  lastStickerId: string | null
  lastWasAudio: boolean
  lastRemoved: boolean
  lastMessageAt: string
  unread: number
}

export async function fetchThreadList(viewerId: string): Promise<ThreadSummary[]> {
  const supabase = createClient()
  const { data: threads } = await supabase
    .from('dm_threads')
    .select('id, player_a, player_b, last_message_at')
    .or(`player_a.eq.${viewerId},player_b.eq.${viewerId}`)
    .order('last_message_at', { ascending: false })
  if (!threads || threads.length === 0) return []

  const threadIds = threads.map((t) => t.id)
  const otherIds = threads.map((t) => (t.player_a === viewerId ? t.player_b : t.player_a))

  const [{ data: profiles }, { data: msgs }, { data: blocks }] = await Promise.all([
    supabase.from('profiles').select(PROFILE).in('id', otherIds),
    supabase
      .from('dm_messages')
      .select('thread_id, sender_id, body, image_url, created_at, read_at, deleted_at, sticker_id, audio_url')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as ProfileRow]))
  const blockRows: BlockRow[] = (blocks ?? []).map((b) => ({ blockerId: b.blocker_id, blockedId: b.blocked_id }))
  const byThread = new Map<
    string,
    { sender_id: string; body: string | null; image_url: string | null; read_at: string | null; deleted_at: string | null; sticker_id: string | null; audio_url: string | null }[]
  >()
  for (const m of msgs ?? []) {
    const list = byThread.get(m.thread_id) ?? []
    list.push(m)
    byThread.set(m.thread_id, list)
  }

  const out: ThreadSummary[] = []
  for (const t of threads) {
    const otherId = t.player_a === viewerId ? t.player_b : t.player_a
    if (isBlockedBetween(blockRows, viewerId, otherId)) continue
    const list = byThread.get(t.id) ?? []
    const last = list[list.length - 1]
    const other = profileById.get(otherId)
    const lastContent = last
      ? resolveParticipantContent({
          body: last.body,
          imageUrl: last.image_url,
          deletedAt: last.deleted_at,
          stickerId: last.sticker_id,
          audioUrl: last.audio_url,
        })
      : null
    out.push({
      threadId: t.id,
      otherId,
      otherName: other?.display_name ?? other?.username ?? 'Player',
      otherUsername: other?.username ?? null,
      otherAvatarUrl: other?.avatar_url ?? null,
      lastMessage: lastContent?.body ?? null,
      lastWasImage: !!lastContent && lastContent.body == null && lastContent.stickerId == null && lastContent.imageUrl != null,
      lastStickerId: lastContent?.stickerId ?? null,
      lastWasAudio: !!lastContent && lastContent.body == null && lastContent.stickerId == null && lastContent.imageUrl == null && lastContent.audioUrl != null,
      lastRemoved: lastContent?.removed ?? false,
      lastMessageAt: t.last_message_at,
      unread: unreadCount(list.map((m) => ({ senderId: m.sender_id, readAt: m.read_at })), viewerId),
    })
  }
  return out
}

export type ConversationMessage = {
  id: string
  senderId: string
  body: string | null
  imageUrl: string | null
  stickerId: string | null
  audioUrl: string | null
  audioDurationSeconds: number | null
  forwarded: boolean
  createdAt: string
  readAt: string | null
  editedAt: string | null
  deletedAt: string | null
  replyTo: { id: string; senderName: string; body: string | null; removed: boolean } | null
}

export type ThreadDetail = {
  threadId: string
  other: { id: string; name: string; username: string | null; avatarUrl: string | null }
  messages: ConversationMessage[]
  blockedByMe: boolean
  blockedByThem: boolean
}

export async function fetchThread(threadId: string, viewerId: string): Promise<ThreadDetail | null> {
  const supabase = createClient()
  const { data: thread } = await supabase
    .from('dm_threads')
    .select('id, player_a, player_b')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread) return null
  if (viewerId !== thread.player_a && viewerId !== thread.player_b) return null

  const otherId = thread.player_a === viewerId ? thread.player_b : thread.player_a

  const [{ data: other }, { data: messages }, { data: blocks }] = await Promise.all([
    supabase.from('profiles').select(PROFILE).eq('id', otherId).maybeSingle(),
    supabase
      .from('dm_messages')
      .select(
        'id, sender_id, body, image_url, created_at, read_at, edited_at, deleted_at, reply_to_id, sticker_id, audio_url, audio_duration_seconds, forwarded',
      )
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const rows = messages ?? []
  const [signedImages, signedAudio] = await Promise.all([
    signPaths('dm-images', rows.filter((m) => m.image_url && !m.deleted_at).map((m) => m.image_url as string)),
    signPaths('dm-audio', rows.filter((m) => m.audio_url && !m.deleted_at).map((m) => m.audio_url as string)),
  ])

  const replyIds = Array.from(new Set(rows.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string)))
  const replyTargets = new Map<
    string,
    { sender_id: string; body: string | null; image_url: string | null; deleted_at: string | null; sticker_id: string | null; audio_url: string | null }
  >()
  if (replyIds.length > 0) {
    const { data: targets } = await supabase
      .from('dm_messages')
      .select('id, sender_id, body, image_url, deleted_at, sticker_id, audio_url')
      .in('id', replyIds)
    for (const t of targets ?? []) replyTargets.set(t.id, t)
  }
  function resolveReply(replyToId: string | null): ConversationMessage['replyTo'] {
    if (!replyToId) return null
    const target = replyTargets.get(replyToId)
    if (!target) return null
    const content = resolveParticipantContent({
      body: target.body,
      imageUrl: target.image_url,
      deletedAt: target.deleted_at,
      stickerId: target.sticker_id,
      audioUrl: target.audio_url,
    })
    // Fills in a display label for content types that have no text body of
    // their own — an actual image still falls through to null here, and
    // callers (MessageBubble, MessageComposer) fall back to '📷 Photo'.
    const body = content.removed
      ? null
      : (content.body ?? (content.stickerId ? `${stickerById(content.stickerId)?.emoji ?? '🙂'} Sticker` : content.audioUrl ? '🎤 Voice note' : null))
    return {
      id: replyToId,
      senderName: target.sender_id === viewerId ? 'You' : (other?.display_name ?? other?.username ?? 'Player'),
      body,
      removed: content.removed,
    }
  }

  const blockRows = (blocks ?? []) as { blocker_id: string; blocked_id: string }[]

  return {
    threadId,
    other: {
      id: otherId,
      name: other?.display_name ?? other?.username ?? 'Player',
      username: other?.username ?? null,
      avatarUrl: other?.avatar_url ?? null,
    },
    messages: rows.map((m) => {
      const content = resolveParticipantContent({
        body: m.body,
        imageUrl: m.image_url,
        deletedAt: m.deleted_at,
        stickerId: m.sticker_id,
        audioUrl: m.audio_url,
      })
      return {
        id: m.id,
        senderId: m.sender_id,
        body: content.body,
        imageUrl: content.imageUrl ? (signedImages.get(content.imageUrl) ?? null) : null,
        stickerId: content.stickerId,
        audioUrl: content.audioUrl ? (signedAudio.get(content.audioUrl) ?? null) : null,
        audioDurationSeconds: content.removed ? null : m.audio_duration_seconds,
        forwarded: m.forwarded,
        createdAt: m.created_at,
        readAt: m.read_at,
        editedAt: m.edited_at,
        deletedAt: m.deleted_at,
        replyTo: resolveReply(m.reply_to_id),
      }
    }),
    blockedByMe: blockRows.some((b) => b.blocker_id === viewerId && b.blocked_id === otherId),
    blockedByThem: blockRows.some((b) => b.blocker_id === otherId && b.blocked_id === viewerId),
  }
}

export async function resolveThreadId(viewerId: string, otherId: string): Promise<string | null> {
  const supabase = createClient()
  const { playerA, playerB } = orderedPair(viewerId, otherId)
  const { data } = await supabase
    .from('dm_threads')
    .select('id')
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .maybeSingle()
  return data?.id ?? null
}

export type ProfileMessagingState = { blockedByMe: boolean; blockedByThem: boolean }

export async function fetchProfileMessagingState(
  viewerId: string,
  profileId: string,
): Promise<ProfileMessagingState> {
  const supabase = createClient()
  const { data } = await supabase
    .from('dm_blocks')
    .select('blocker_id, blocked_id')
    .or(
      `and(blocker_id.eq.${viewerId},blocked_id.eq.${profileId}),and(blocker_id.eq.${profileId},blocked_id.eq.${viewerId})`,
    )
  const rows = data ?? []
  return {
    blockedByMe: rows.some((b) => b.blocker_id === viewerId),
    blockedByThem: rows.some((b) => b.blocker_id === profileId),
  }
}

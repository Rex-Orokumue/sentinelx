import { decodeCursor, encodeCursor, keysetFilterOn } from '@/lib/mobile-api/history-cursor'
import { isBlockedBetween, resolveParticipantContent, type BlockRow } from './predicates'
import { stickerById } from './stickers'
import type { MessageCtx, RequestState } from './service'

// API-served DM reads for the mobile app: paged, media signed server-side, no reliance on direct profile reads.
export const THREAD_PAGE_SIZE = 20
export const MESSAGE_PAGE_SIZE = 40

const PROFILE = 'id, username, display_name, avatar_url'
type ProfileRow = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }

export type Direction = 'incoming' | 'outgoing' | null
// Only a PENDING request has a direction: who started it decides whether the viewer answers it or waits for an answer.
function directionOf(state: RequestState, createdBy: string | null | undefined, userId: string): Direction {
  if (state !== 'pending' || !createdBy) return null
  return createdBy === userId ? 'outgoing' : 'incoming'
}
const stateOf = (v: unknown): RequestState => (v === 'pending' || v === 'declined' ? v : 'accepted')

export type Participant = { id: string; name: string; username: string | null; avatarUrl: string | null }
export type ThreadPreview = {
  kind: 'text' | 'image' | 'sticker' | 'voice' | 'removed' | 'none'
  text: string | null
  stickerId: string | null
}
export type ThreadItem = {
  threadId: string
  other: Participant
  preview: ThreadPreview
  lastMessageAt: string
  unread: number
  requestState: RequestState
  direction: Direction
}
export type ThreadHeader = {
  threadId: string
  other: Participant
  blockedByMe: boolean
  blockedByThem: boolean
  requestState: RequestState
  direction: Direction
}
export type MessageItem = {
  id: string
  senderId: string
  body: string | null
  imageUrl: string | null
  stickerId: string | null
  audioUrl: string | null
  audioDurationSeconds: number | null
  forwarded: boolean
  createdAt: string
  deliveredAt: string | null
  readAt: string | null
  editedAt: string | null
  deletedAt: string | null
  replyTo: { id: string; senderName: string; body: string | null; removed: boolean } | null
}

function participant(id: string, p: ProfileRow | undefined): Participant {
  return { id, name: p?.display_name ?? p?.username ?? 'Player', username: p?.username ?? null, avatarUrl: p?.avatar_url ?? null }
}

async function profilesById(ctx: MessageCtx, ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map()
  const { data } = await ctx.admin.from('profiles').select(PROFILE).in('id', ids)
  return new Map(((data ?? []) as ProfileRow[]).map((p) => [p.id, p]))
}

async function signPaths(ctx: MessageCtx, bucket: 'dm-images' | 'dm-audio', paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    paths.map(async (p) => {
      const { data } = await ctx.admin.storage.from(bucket).createSignedUrl(p, 3600)
      if (data?.signedUrl) out.set(p, data.signedUrl)
    }),
  )
  return out
}

type LastRow = {
  body: string | null
  image_url: string | null
  sticker_id: string | null
  audio_url: string | null
  deleted_at: string | null
}

function previewOf(last: LastRow | null): ThreadPreview {
  if (!last) return { kind: 'none', text: null, stickerId: null }
  const c = resolveParticipantContent({
    body: last.body,
    imageUrl: last.image_url,
    deletedAt: last.deleted_at,
    stickerId: last.sticker_id,
    audioUrl: last.audio_url,
  })
  if (c.removed) return { kind: 'removed', text: null, stickerId: null }
  if (c.body) return { kind: 'text', text: c.body, stickerId: null }
  if (c.stickerId) return { kind: 'sticker', text: null, stickerId: c.stickerId }
  if (c.imageUrl) return { kind: 'image', text: null, stickerId: null }
  if (c.audioUrl) return { kind: 'voice', text: null, stickerId: null }
  return { kind: 'none', text: null, stickerId: null }
}

async function blocksFor(ctx: MessageCtx): Promise<BlockRow[]> {
  const { data } = await ctx.supabase
    .from('dm_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${ctx.userId},blocked_id.eq.${ctx.userId}`)
  return (data ?? []).map((b) => ({ blockerId: b.blocker_id, blockedId: b.blocked_id }))
}

export type Box = 'inbox' | 'requests'

export async function listThreads(
  ctx: MessageCtx,
  opts: { cursor?: string; box?: Box },
): Promise<{ threads: ThreadItem[]; nextCursor: string | null; requestCount: number }> {
  const { supabase, userId } = ctx
  const box: Box = opts.box ?? 'inbox'
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null
  const participantFilter = `player_a.eq.${userId},player_b.eq.${userId}`

  let query = supabase
    .from('dm_threads')
    .select('id, player_a, player_b, last_message_at, request_state, created_by')
    .or(participantFilter)
  // inbox: accepted threads plus the viewer's own PENDING requests. requests: incoming pending only.
  // A DECLINED thread is in neither box for either side: a block hides a thread from both players, and a decline must not
  // be a separate signal to the person who sent the request.
  query = box === 'requests' ? query.eq('request_state', 'pending').neq('created_by', userId) : query.or(`request_state.eq.accepted,and(request_state.eq.pending,created_by.eq.${userId})`)
  if (cursor) query = query.or(keysetFilterOn('last_message_at', cursor))

  const [{ data }, blocks, incoming] = await Promise.all([
    query
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(THREAD_PAGE_SIZE + 1),
    blocksFor(ctx),
    supabase
      .from('dm_threads')
      .select('id, player_a, player_b')
      .eq('request_state', 'pending')
      .neq('created_by', userId)
      .or(participantFilter)
      .limit(100),
  ])

  const otherOf = (t: { player_a: string; player_b: string }) => (t.player_a === userId ? t.player_b : t.player_a)
  const requestCount = (incoming.data ?? []).filter((t) => !isBlockedBetween(blocks, userId, otherOf(t))).length

  const rows = data ?? []
  const page = rows.slice(0, THREAD_PAGE_SIZE)
  const nextCursor =
    rows.length > THREAD_PAGE_SIZE
      ? encodeCursor({ created_at: page[page.length - 1].last_message_at, id: page[page.length - 1].id })
      : null
  if (page.length === 0) return { threads: [], nextCursor, requestCount }

  const profiles = await profilesById(ctx, page.map(otherOf))
  const visible = page.filter((t) => !isBlockedBetween(blocks, userId, otherOf(t)))

  // One last-message and one unread-count query per visible thread (page size <= 20, both indexed).
  const threads = await Promise.all(
    visible.map(async (t): Promise<ThreadItem> => {
      const [{ data: last }, { count }] = await Promise.all([
        supabase
          .from('dm_messages')
          .select('sender_id, body, image_url, sticker_id, audio_url, deleted_at')
          .eq('thread_id', t.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('dm_messages')
          .select('id', { count: 'exact', head: true })
          .eq('thread_id', t.id)
          .neq('sender_id', userId)
          .is('read_at', null),
      ])
      const otherId = otherOf(t)
      const requestState = stateOf(t.request_state)
      return {
        threadId: t.id,
        other: participant(otherId, profiles.get(otherId)),
        preview: previewOf((last as LastRow | null) ?? null),
        lastMessageAt: t.last_message_at,
        unread: count ?? 0,
        requestState,
        direction: directionOf(requestState, t.created_by, userId),
      }
    }),
  )
  return { threads, nextCursor, requestCount }
}

export async function getThreadHeader(ctx: MessageCtx, threadId: string): Promise<ThreadHeader | null> {
  const { supabase, userId } = ctx
  const { data: thread } = await supabase
    .from('dm_threads')
    .select('id, player_a, player_b, request_state, created_by')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread || (thread.player_a !== userId && thread.player_b !== userId)) return null
  const otherId = thread.player_a === userId ? thread.player_b : thread.player_a
  const [profiles, blocks] = await Promise.all([profilesById(ctx, [otherId]), blocksFor(ctx)])
  const rawState = stateOf(thread.request_state)
  // To the player who SENT a declined request it is indistinguishable from a block: blockedByThem, never 'declined'.
  const declinedForSender = rawState === 'declined' && thread.created_by === userId
  const requestState: RequestState = declinedForSender ? 'accepted' : rawState
  return {
    threadId,
    other: participant(otherId, profiles.get(otherId)),
    blockedByMe: blocks.some((b) => b.blockerId === userId && b.blockedId === otherId),
    blockedByThem: declinedForSender || blocks.some((b) => b.blockerId === otherId && b.blockedId === userId),
    requestState,
    direction: directionOf(requestState, thread.created_by, userId),
  }
}

type MessageRow = {
  id: string
  sender_id: string
  body: string | null
  image_url: string | null
  sticker_id: string | null
  audio_url: string | null
  audio_duration_seconds: number | null
  forwarded: boolean
  created_at: string
  delivered_at: string | null
  read_at: string | null
  edited_at: string | null
  deleted_at: string | null
  reply_to_id: string | null
}

export async function listMessages(
  ctx: MessageCtx,
  threadId: string,
  opts: { before?: string },
): Promise<{ messages: MessageItem[]; nextBefore: string | null } | null> {
  const { supabase, userId } = ctx
  const before = opts.before ? decodeCursor(opts.before) : null

  const header = await getThreadHeader(ctx, threadId)
  if (!header) return null

  let query = supabase
    .from('dm_messages')
    .select(
      'id, sender_id, body, image_url, sticker_id, audio_url, audio_duration_seconds, forwarded, created_at, delivered_at, read_at, edited_at, deleted_at, reply_to_id',
    )
    .eq('thread_id', threadId)
  if (before) query = query.or(keysetFilterOn('created_at', before))
  const { data } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE + 1)

  const rows = (data ?? []) as MessageRow[]
  const page = rows.slice(0, MESSAGE_PAGE_SIZE)
  const nextBefore =
    rows.length > MESSAGE_PAGE_SIZE ? encodeCursor({ created_at: page[page.length - 1].created_at, id: page[page.length - 1].id }) : null

  const live = page.filter((m) => !m.deleted_at)
  const [signedImages, signedAudio] = await Promise.all([
    signPaths(ctx, 'dm-images', live.filter((m) => m.image_url).map((m) => m.image_url as string)),
    signPaths(ctx, 'dm-audio', live.filter((m) => m.audio_url).map((m) => m.audio_url as string)),
  ])

  const replyIds = Array.from(new Set(page.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string)))
  const replyTargets = new Map<string, { sender_id: string } & LastRow>()
  if (replyIds.length > 0) {
    const { data: targets } = await supabase
      .from('dm_messages')
      .select('id, sender_id, body, image_url, deleted_at, sticker_id, audio_url')
      .in('id', replyIds)
    for (const t of (targets ?? []) as ({ id: string; sender_id: string } & LastRow)[]) replyTargets.set(t.id, t)
  }

  function resolveReply(replyToId: string | null): MessageItem['replyTo'] {
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
    const body = content.removed
      ? null
      : (content.body ?? (content.stickerId ? `${stickerById(content.stickerId)?.emoji ?? '🙂'} Sticker` : content.audioUrl ? '🎤 Voice note' : null))
    return {
      id: replyToId,
      senderName: target.sender_id === userId ? 'You' : header!.other.name,
      body,
      removed: content.removed,
    }
  }

  const messages = page.map((m): MessageItem => {
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
      deliveredAt: m.delivered_at,
      readAt: m.read_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      replyTo: resolveReply(m.reply_to_id),
    }
  })
  return { messages, nextBefore }
}

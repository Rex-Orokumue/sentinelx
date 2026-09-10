import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orderedPair } from './thread-key'
import { unreadCount, isBlockedBetween, type BlockRow } from './predicates'

const PROFILE = 'id, username, display_name, avatar_url'
type ProfileRow = { id: string; username: string | null; display_name: string | null; avatar_url: string | null }

async function signImages(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const admin = createAdminClient()
  await Promise.all(
    paths.map(async (p) => {
      const { data } = await admin.storage.from('dm-images').createSignedUrl(p, 3600)
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
      .select('thread_id, sender_id, body, image_url, created_at, read_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as ProfileRow]))
  const blockRows: BlockRow[] = (blocks ?? []).map((b) => ({ blockerId: b.blocker_id, blockedId: b.blocked_id }))
  const byThread = new Map<string, { sender_id: string; body: string | null; image_url: string | null; read_at: string | null }[]>()
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
    out.push({
      threadId: t.id,
      otherId,
      otherName: other?.display_name ?? other?.username ?? 'Player',
      otherUsername: other?.username ?? null,
      otherAvatarUrl: other?.avatar_url ?? null,
      lastMessage: last?.body ?? null,
      lastWasImage: !!last && last.body == null && last.image_url != null,
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
  createdAt: string
  readAt: string | null
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
      .select('id, sender_id, body, image_url, created_at, read_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
    supabase
      .from('dm_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ])

  const rows = messages ?? []
  const signed = await signImages(rows.filter((m) => m.image_url).map((m) => m.image_url as string))
  const blockRows = (blocks ?? []) as { blocker_id: string; blocked_id: string }[]

  return {
    threadId,
    other: {
      id: otherId,
      name: other?.display_name ?? other?.username ?? 'Player',
      username: other?.username ?? null,
      avatarUrl: other?.avatar_url ?? null,
    },
    messages: rows.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
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

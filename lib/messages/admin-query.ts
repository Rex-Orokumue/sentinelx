import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { countNewContactsSince } from './predicates'

export type DmTranscriptMessage = {
  id: string
  senderName: string
  body: string | null
  imageUrl: string | null
  stickerId: string | null
  audioUrl: string | null
  audioDurationSeconds: number | null
  forwarded: boolean
  createdAt: string
  flagged: boolean
  editedAt: string | null
  deletedAt: string | null
  editHistory: { bodyBefore: string | null; editedAt: string }[]
}

export type DmReportView = {
  id: string
  reason: string
  createdAt: string
  resolvedAt: string | null
  reporterName: string | null
  reportedName: string | null
  reportedId: string
  reportedMuted: boolean
  reportedNewContacts24h: number
  threadId: string
  flaggedMessageId: string | null
  transcript: DmTranscriptMessage[]
}

type MsgRow = {
  id: string
  thread_id: string
  sender_id: string
  body: string | null
  image_url: string | null
  sticker_id: string | null
  audio_url: string | null
  audio_duration_seconds: number | null
  forwarded: boolean
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export async function fetchDmReports(limit = 40): Promise<DmReportView[]> {
  const supabase = createClient()
  const { data: reports } = await supabase
    .from('dm_reports')
    .select('id, reason, created_at, resolved_at, message_id, thread_id, reporter_id, reported_id')
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!reports || reports.length === 0) return []

  const threadIds = Array.from(new Set(reports.map((r) => r.thread_id)))
  const reportedIds = Array.from(new Set(reports.map((r) => r.reported_id)))
  const personIds = Array.from(new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id])))

  const [{ data: profiles }, { data: msgs }, { data: mutes }, { data: startedThreads }] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name').in('id', personIds),
    supabase
      .from('dm_messages')
      .select('id, thread_id, sender_id, body, image_url, sticker_id, audio_url, audio_duration_seconds, forwarded, created_at, edited_at, deleted_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: true }),
    supabase.from('dm_muted_players').select('player_id').in('player_id', reportedIds),
    supabase.from('dm_threads').select('created_by, created_at').in('created_by', reportedIds),
  ])

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player'] as const))
  const mutedSet = new Set((mutes ?? []).map((m) => m.player_id))
  const startedByPlayer = new Map<string, string[]>()
  for (const t of startedThreads ?? []) {
    const list = startedByPlayer.get(t.created_by) ?? []
    list.push(t.created_at)
    startedByPlayer.set(t.created_by, list)
  }
  const msgsByThread = new Map<string, MsgRow[]>()
  for (const m of (msgs ?? []) as MsgRow[]) {
    const list = msgsByThread.get(m.thread_id) ?? []
    list.push(m)
    msgsByThread.set(m.thread_id, list)
  }

  const allMsgIds = ((msgs ?? []) as MsgRow[]).map((m) => m.id)
  const { data: edits } =
    allMsgIds.length > 0
      ? await supabase.from('dm_message_edits').select('message_id, body_before, edited_at').in('message_id', allMsgIds).order('edited_at', { ascending: true })
      : { data: [] }
  const editsByMessage = new Map<string, { bodyBefore: string | null; editedAt: string }[]>()
  for (const e of edits ?? []) {
    const list = editsByMessage.get(e.message_id) ?? []
    list.push({ bodyBefore: e.body_before, editedAt: e.edited_at })
    editsByMessage.set(e.message_id, list)
  }

  // Sign every image/audio path once.
  const admin = createAdminClient()
  async function signAll(bucket: 'dm-images' | 'dm-audio', paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    await Promise.all(
      paths.map(async (p) => {
        const { data } = await admin.storage.from(bucket).createSignedUrl(p, 3600)
        if (data?.signedUrl) out.set(p, data.signedUrl)
      }),
    )
    return out
  }
  const allRows = (msgs ?? []) as MsgRow[]
  const [signed, signedAudio] = await Promise.all([
    signAll('dm-images', Array.from(new Set(allRows.filter((m) => m.image_url).map((m) => m.image_url as string)))),
    signAll('dm-audio', Array.from(new Set(allRows.filter((m) => m.audio_url).map((m) => m.audio_url as string)))),
  ])

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  return reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    reporterName: nameById.get(r.reporter_id) ?? null,
    reportedName: nameById.get(r.reported_id) ?? null,
    reportedId: r.reported_id,
    reportedMuted: mutedSet.has(r.reported_id),
    reportedNewContacts24h: countNewContactsSince(startedByPlayer.get(r.reported_id) ?? [], dayAgo),
    threadId: r.thread_id,
    flaggedMessageId: r.message_id,
    transcript: (msgsByThread.get(r.thread_id) ?? []).map((m) => ({
      id: m.id,
      senderName: nameById.get(m.sender_id) ?? 'Player',
      body: m.body,
      imageUrl: m.image_url ? (signed.get(m.image_url) ?? null) : null,
      stickerId: m.sticker_id,
      audioUrl: m.audio_url ? (signedAudio.get(m.audio_url) ?? null) : null,
      audioDurationSeconds: m.audio_duration_seconds,
      forwarded: m.forwarded,
      createdAt: m.created_at,
      flagged: m.id === r.message_id,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      editHistory: editsByMessage.get(m.id) ?? [],
    })),
  }))
}

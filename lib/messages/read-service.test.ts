import { describe, it, expect } from 'vitest'
import { fakeAdmin, methods, type Op } from '@/lib/notifications/fake-admin'
import { listThreads, getThreadHeader, listMessages, THREAD_PAGE_SIZE, MESSAGE_PAGE_SIZE } from './read-service'
import { decodeCursor, encodeCursor } from '@/lib/mobile-api/history-cursor'

const ME = 'me'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const eqVal = (op: Op, col: string) => op.ops.find(([m, a]) => m === 'eq' && a[0] === col)?.[1][1]

type ThreadRow = { id: string; player_a: string; player_b: string; last_message_at: string; request_state?: string; created_by?: string }
type Over = {
  threads?: ThreadRow[]
  blocks?: { blocker_id: string; blocked_id: string }[]
  last?: Record<string, unknown>
  unread?: Record<string, number>
  messages?: Record<string, unknown>[]
  replyTargets?: Record<string, unknown>[]
  headerThread?: ThreadRow | null
  incoming?: { id: string; player_a: string; player_b: string }[]
}

function build(over: Over) {
  const sess = fakeAdmin((op) => {
    const ms = methods(op)
    if (op.table === 'dm_threads') {
      if (ms.includes('maybeSingle')) return { data: over.headerThread ?? null }
      const cols = String(op.ops.find(([m]) => m === 'select')?.[1][0] ?? '')
      if (cols === 'id, player_a, player_b') return { data: over.incoming ?? [] }
      return { data: over.threads ?? [] }
    }
    if (op.table === 'dm_blocks') return { data: over.blocks ?? [] }
    if (op.table === 'dm_messages') {
      const tid = String(eqVal(op, 'thread_id'))
      if (ms.includes('is')) return { data: null, count: over.unread?.[tid] ?? 0 }
      if (ms.includes('maybeSingle')) return { data: over.last?.[tid] ?? null }
      if (ms.includes('in')) return { data: over.replyTargets ?? [] }
      return { data: over.messages ?? [] }
    }
    return { data: null }
  })
  const adm = fakeAdmin((op) => {
    if (op.table === 'profiles') {
      return { data: [{ id: 'other', username: 'rex', display_name: 'Rex', avatar_url: null }] }
    }
    return { data: null }
  })
  const storage = {
    from: (bucket: string) => ({
      createSignedUrl: async (p: string) => (p.includes('bad') ? { data: null } : { data: { signedUrl: `https://signed/${bucket}/${p}` } }),
    }),
  }
  const ctx = { supabase: sess.admin, admin: Object.assign(adm.admin as object, { storage }), userId: ME } as never
  return { ctx, sess, adm }
}

const t = (n: number, at = '2026-10-04T10:00:00Z'): ThreadRow => ({ id: uuid(n), player_a: ME, player_b: 'other', last_message_at: at })

describe('listThreads', () => {
  it('returns the other player, preview and unread count', async () => {
    const { ctx } = build({
      threads: [t(1)],
      last: { [uuid(1)]: { sender_id: 'other', body: 'gg', image_url: null, sticker_id: null, audio_url: null, deleted_at: null } },
      unread: { [uuid(1)]: 3 },
    })
    const res = await listThreads(ctx, {})
    expect(res.threads).toEqual([
      {
        threadId: uuid(1),
        other: { id: 'other', name: 'Rex', username: 'rex', avatarUrl: null },
        preview: { kind: 'text', text: 'gg', stickerId: null },
        lastMessageAt: '2026-10-04T10:00:00Z',
        unread: 3,
        requestState: 'accepted',
        direction: null,
      },
    ])
    expect(res.nextCursor).toBeNull()
  })

  it('hides a thread blocked in either direction', async () => {
    const { ctx } = build({ threads: [t(1)], blocks: [{ blocker_id: 'other', blocked_id: ME }] })
    expect((await listThreads(ctx, {})).threads).toEqual([])
  })

  it('labels an unsent last message as removed and an audio one as voice', async () => {
    const mk = (id: number, last: Record<string, unknown>) => build({ threads: [t(id)], last: { [uuid(id)]: last } })
    const removed = mk(1, { sender_id: 'other', body: 'secret', image_url: null, sticker_id: null, audio_url: null, deleted_at: '2026-10-04T10:01:00Z' })
    expect((await listThreads(removed.ctx, {})).threads[0].preview).toEqual({ kind: 'removed', text: null, stickerId: null })
    const voice = mk(2, { sender_id: 'other', body: null, image_url: null, sticker_id: null, audio_url: 'x/v.m4a', deleted_at: null })
    expect((await listThreads(voice.ctx, {})).threads[0].preview.kind).toBe('voice')
  })

  it('pages: 21 rows give 20 threads and a cursor at the 20th', async () => {
    const rows = Array.from({ length: THREAD_PAGE_SIZE + 1 }, (_, i) => t(i + 1, `2026-10-04T10:00:${String(59 - i).padStart(2, '0')}Z`))
    const { ctx } = build({ threads: rows })
    const res = await listThreads(ctx, {})
    expect(res.threads).toHaveLength(THREAD_PAGE_SIZE)
    expect(decodeCursor(res.nextCursor!).id).toBe(rows[THREAD_PAGE_SIZE - 1].id)
  })

  it('asks the database for rows older than the cursor on last_message_at', async () => {
    const { ctx, sess } = build({ threads: [] })
    await listThreads(ctx, { cursor: encodeCursor({ created_at: '2026-10-04T10:00:00Z', id: uuid(5) }) })
    const q = sess.calls.find((c) => c.table === 'dm_threads')!
    expect(JSON.stringify(q.ops)).toContain('last_message_at.lt.\\"2026-10-04T10:00:00Z\\"')
  })

  it('rejects a malformed or injected cursor', async () => {
    const { ctx } = build({ threads: [] })
    await expect(listThreads(ctx, { cursor: '%%%' })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    const injected = Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00Z),id.eq.1', id: uuid(1) })).toString('base64url')
    await expect(listThreads(ctx, { cursor: injected })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
  })
})

describe('getThreadHeader', () => {
  it('is null when the caller is not a participant', async () => {
    const { ctx } = build({ headerThread: { id: uuid(1), player_a: 'x', player_b: 'y', last_message_at: '' } })
    expect(await getThreadHeader(ctx, uuid(1))).toBeNull()
  })
  it('is null when the thread does not exist', async () => {
    const { ctx } = build({ headerThread: null })
    expect(await getThreadHeader(ctx, uuid(1))).toBeNull()
  })
  it('reports who blocked whom', async () => {
    const { ctx } = build({ headerThread: t(1), blocks: [{ blocker_id: ME, blocked_id: 'other' }] })
    expect(await getThreadHeader(ctx, uuid(1))).toMatchObject({ threadId: uuid(1), blockedByMe: true, blockedByThem: false })
    const them = build({ headerThread: t(1), blocks: [{ blocker_id: 'other', blocked_id: ME }] })
    expect(await getThreadHeader(them.ctx, uuid(1))).toMatchObject({ blockedByMe: false, blockedByThem: true })
  })
})

describe('listMessages', () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: uuid(n), sender_id: 'other', body: `m${n}`, image_url: null, sticker_id: null, audio_url: null, audio_duration_seconds: null,
    forwarded: false, created_at: `2026-10-04T10:00:${String(59 - n).padStart(2, '0')}Z`, delivered_at: null, read_at: null,
    edited_at: null, deleted_at: null, reply_to_id: null, ...extra,
  })

  it('is null when the caller is not in the thread', async () => {
    const { ctx } = build({ headerThread: { id: uuid(1), player_a: 'x', player_b: 'y', last_message_at: '' } })
    expect(await listMessages(ctx, uuid(1), {})).toBeNull()
  })

  it('redacts an unsent message', async () => {
    const { ctx } = build({ headerThread: t(1), messages: [row(1, { body: 'secret', deleted_at: '2026-10-04T10:05:00Z' })] })
    const res = await listMessages(ctx, uuid(1), {})
    expect(res!.messages[0]).toMatchObject({ body: null, imageUrl: null, stickerId: null, audioUrl: null, audioDurationSeconds: null })
  })

  it('signs media from the right bucket and returns null when signing fails', async () => {
    const { ctx } = build({
      headerThread: t(1),
      messages: [
        row(1, { body: null, image_url: 'other/a.jpg' }),
        row(2, { body: null, audio_url: 'other/v.m4a', audio_duration_seconds: 12 }),
        row(3, { body: null, image_url: 'other/bad.jpg' }),
      ],
    })
    const res = await listMessages(ctx, uuid(1), {})
    expect(res!.messages[0].imageUrl).toBe('https://signed/dm-images/other/a.jpg')
    expect(res!.messages[1].audioUrl).toBe('https://signed/dm-audio/other/v.m4a')
    expect(res!.messages[1].audioDurationSeconds).toBe(12)
    expect(res!.messages[2].imageUrl).toBeNull()
  })

  it('pages newest-first with a cursor at the oldest returned row', async () => {
    const rows = Array.from({ length: MESSAGE_PAGE_SIZE + 1 }, (_, i) => row(i + 1))
    const { ctx } = build({ headerThread: t(1), messages: rows })
    const res = await listMessages(ctx, uuid(1), {})
    expect(res!.messages).toHaveLength(MESSAGE_PAGE_SIZE)
    expect(decodeCursor(res!.nextBefore!).id).toBe(rows[MESSAGE_PAGE_SIZE - 1].id)
  })

  it('has no cursor on the last page', async () => {
    const { ctx } = build({ headerThread: t(1), messages: [row(1)] })
    expect((await listMessages(ctx, uuid(1), {}))!.nextBefore).toBeNull()
  })

  it('resolves a reply preview with who wrote it', async () => {
    const { ctx } = build({
      headerThread: t(1),
      messages: [row(2, { reply_to_id: uuid(1), sender_id: ME })],
      replyTargets: [{ id: uuid(1), sender_id: 'other', body: 'original', image_url: null, deleted_at: null, sticker_id: null, audio_url: null }],
    })
    const res = await listMessages(ctx, uuid(1), {})
    expect(res!.messages[0].replyTo).toEqual({ id: uuid(1), senderName: 'Rex', body: 'original', removed: false })
  })

  it('rejects a malformed cursor', async () => {
    const { ctx } = build({ headerThread: t(1) })
    await expect(listMessages(ctx, uuid(1), { before: 'nope' })).rejects.toMatchObject({ code: 'invalid_cursor' })
  })
})

describe('listThreads message requests', () => {
  const req = (n: number, extra: Partial<ThreadRow> = {}): ThreadRow => ({ ...t(n), request_state: 'pending', created_by: 'other', ...extra })

  it('marks an incoming pending thread, and an outgoing one', async () => {
    const incoming = build({ threads: [req(1)] })
    expect((await listThreads(incoming.ctx, { box: 'requests' })).threads[0]).toMatchObject({ requestState: 'pending', direction: 'incoming' })
    const outgoing = build({ threads: [req(2, { created_by: ME })] })
    expect((await listThreads(outgoing.ctx, {})).threads[0]).toMatchObject({ requestState: 'pending', direction: 'outgoing' })
  })

  it('direction is null once a thread is accepted', async () => {
    const { ctx } = build({ threads: [req(1, { request_state: 'accepted' })] })
    expect((await listThreads(ctx, {})).threads[0]).toMatchObject({ requestState: 'accepted', direction: null })
  })

  it('the inbox shows accepted threads and the viewer own PENDING requests only', async () => {
    const { ctx, sess } = build({ threads: [] })
    await listThreads(ctx, { box: 'inbox' })
    const q = sess.calls.find((c) => c.table === 'dm_threads')!
    expect(JSON.stringify(q.ops)).toContain(`request_state.eq.accepted,and(request_state.eq.pending,created_by.eq.${ME})`)
    // a declined thread is in no inbox, for either side: that is what a block does too
    expect(JSON.stringify(q.ops)).not.toContain('declined')
  })

  it('the requests box shows incoming pending threads only', async () => {
    const { ctx, sess } = build({ threads: [] })
    await listThreads(ctx, { box: 'requests' })
    const q = sess.calls.find((c) => c.table === 'dm_threads')!
    const ops = JSON.stringify(q.ops)
    expect(ops).toContain('"request_state","pending"')
    expect(ops).toContain(`"created_by","${ME}"`)
    expect(ops).toContain('neq')
  })

  it('requestCount counts incoming pending threads and skips blocked ones', async () => {
    const incoming = [
      { id: uuid(1), player_a: ME, player_b: 'other' },
      { id: uuid(2), player_a: ME, player_b: 'blocked-one' },
    ]
    const { ctx } = build({ threads: [], incoming, blocks: [{ blocker_id: ME, blocked_id: 'blocked-one' }] })
    expect((await listThreads(ctx, {})).requestCount).toBe(1)
  })
})

describe('getThreadHeader request info', () => {
  it('reports the request state and who started it', async () => {
    const { ctx } = build({ headerThread: { ...t(1), request_state: 'pending', created_by: 'other' } })
    expect(await getThreadHeader(ctx, uuid(1))).toMatchObject({ requestState: 'pending', direction: 'incoming' })
    const mine = build({ headerThread: { ...t(1), request_state: 'pending', created_by: ME } })
    expect(await getThreadHeader(mine.ctx, uuid(1))).toMatchObject({ requestState: 'pending', direction: 'outgoing' })
  })
})

describe('a declined request looks like a block to the person who sent it', () => {
  it('the initiator header reports blockedByThem and an accepted state, never declined', async () => {
    const { ctx } = build({ headerThread: { ...t(1), request_state: 'declined', created_by: ME } })
    expect(await getThreadHeader(ctx, uuid(1))).toMatchObject({ blockedByThem: true, blockedByMe: false, requestState: 'accepted', direction: null })
  })
  it('the recipient who declined still sees the real state', async () => {
    const { ctx } = build({ headerThread: { ...t(1), request_state: 'declined', created_by: 'other' } })
    expect(await getThreadHeader(ctx, uuid(1))).toMatchObject({ blockedByThem: false, requestState: 'declined' })
  })
})

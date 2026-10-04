import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, methods, type Op } from '@/lib/notifications/fake-admin'

const { notifyBoth, notifyInAppOf } = vi.hoisted(() => ({ notifyBoth: vi.fn(), notifyInAppOf: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInAppOf }))

import {
  startConversation,
  sendMessageCore,
  markThreadRead,
  markAllDelivered,
  acceptRequest,
  declineRequest,
} from './service'

const ME = '11111111-1111-4111-8111-111111111111'
const THEM = '22222222-2222-4222-8222-222222222222'
const T = 'thread-1'

type ThreadState = { request_state?: string; created_by?: string }
function ctxFor(opts: {
  thread?: ThreadState
  exempt?: boolean
  insertError?: { message: string; code?: string }
  created?: ThreadState
}) {
  const session = fakeAdmin((op) => {
    if (op.table === 'dm_messages' && methods(op).includes('single')) {
      return opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'm1', created_at: '2026-10-05T00:00:00Z' } }
    }
    return { data: null }
  })
  const adm = fakeAdmin(
    (op: Op) => {
      if (op.table === 'dm_threads') {
        if (methods(op).includes('insert')) return { data: { id: T } }
        return { data: { player_a: ME, player_b: THEM, created_by: ME, request_state: 'accepted', ...opts.thread } }
      }
      if (op.table === 'profiles') return { data: { display_name: 'Me', username: 'me' } }
      return { data: null }
    },
    { data: opts.exempt ?? false },
  )
  return { c: { supabase: session.admin, admin: adm.admin, userId: ME } as never, session, adm }
}

beforeEach(() => {
  notifyBoth.mockReset()
  notifyInAppOf.mockReset()
})

describe('startConversation request state', () => {
  it('creates an accepted thread when the pair is exempt (staff or accepted friends)', async () => {
    const { c, adm } = ctxFor({ exempt: true })
    // no existing thread -> the lookup misses
    const miss = fakeAdmin((op) => (op.table === 'dm_threads' ? (methods(op).includes('insert') ? { data: { id: T } } : { data: null }) : { data: null }), { data: true })
    const res = await startConversation({ ...(c as object), admin: miss.admin } as never, THEM)
    expect(res).toMatchObject({ ok: true, threadId: T, requestState: 'accepted' })
    expect(miss.rpcCalls[0]).toEqual(['dm_is_exempt', { p_sender: ME, p_other: THEM }])
    void adm
  })
  it('creates a pending thread for strangers', async () => {
    const miss = fakeAdmin((op) => (op.table === 'dm_threads' ? (methods(op).includes('insert') ? { data: { id: T } } : { data: null }) : { data: null }), { data: false })
    const res = await startConversation({ supabase: null, admin: miss.admin, userId: ME } as never, THEM)
    expect(res).toMatchObject({ ok: true, requestState: 'pending' })
    const insert = miss.calls.find((x) => x.table === 'dm_threads' && x.ops.some(([m]) => m === 'insert'))
    expect(JSON.stringify(insert?.ops)).toContain('"request_state":"pending"')
  })
  it('returns the existing thread with its current state', async () => {
    const { c } = ctxFor({ thread: { request_state: 'pending', created_by: THEM } })
    expect(await startConversation(c, THEM)).toMatchObject({ ok: true, requestState: 'pending' })
  })
})

describe('sendMessageCore on a pending thread', () => {
  it('translates the database cap error into a friendly failure', async () => {
    const { c } = ctxFor({ thread: { request_state: 'pending', created_by: ME }, insertError: { message: 'request_pending_limit', code: 'P0001' } })
    expect(await sendMessageCore(c, { threadId: T, body: 'again' })).toEqual({
      ok: false,
      errorCode: 'request_pending_limit',
      message: 'Wait for a reply before sending more.',
    })
  })
  it('translates the database media error into a friendly failure', async () => {
    const { c } = ctxFor({ thread: { request_state: 'pending', created_by: ME }, insertError: { message: 'request_media_not_allowed', code: 'P0001' } })
    expect(await sendMessageCore(c, { threadId: T, imageUrl: `${THEM}/p.jpg` })).toEqual({
      ok: false,
      errorCode: 'request_media_not_allowed',
      message: 'Only text can be sent until they accept.',
    })
  })
  it('records the bell row but sends NO push for the initiator of a pending request', async () => {
    const { c } = ctxFor({ thread: { request_state: 'pending', created_by: ME } })
    const res = await sendMessageCore(c, { threadId: T, body: 'hello' })
    expect(res).toMatchObject({ ok: true })
    expect(notifyInAppOf).toHaveBeenCalledTimes(1)
    expect(notifyInAppOf.mock.calls[0][0]).toBe(THEM)
    expect(notifyInAppOf.mock.calls[0][2]).toBe('direct_message')
    expect(notifyBoth).not.toHaveBeenCalled()
  })
  it('pushes normally once the thread is accepted', async () => {
    const { c } = ctxFor({ thread: { request_state: 'accepted', created_by: ME } })
    await sendMessageCore(c, { threadId: T, body: 'hello' })
    expect(notifyBoth).toHaveBeenCalledTimes(1)
    expect(notifyInAppOf).not.toHaveBeenCalled()
  })
  it('a reply from the recipient of a pending thread pushes normally (it accepts the thread)', async () => {
    const { c } = ctxFor({ thread: { request_state: 'pending', created_by: THEM } })
    await sendMessageCore(c, { threadId: T, body: 'sure' })
    expect(notifyBoth).toHaveBeenCalledTimes(1)
  })
  it('refuses the initiator of a declined thread with the block wording', async () => {
    const { c, session } = ctxFor({ thread: { request_state: 'declined', created_by: ME } })
    expect(await sendMessageCore(c, { threadId: T, body: 'hi' })).toEqual({
      ok: false,
      errorCode: 'blocked',
      message: 'You can no longer message this player.',
    })
    expect(session.calls.some((x) => x.table === 'dm_messages')).toBe(false)
  })
  it('lets the recipient of a declined thread message (it reopens)', async () => {
    const { c } = ctxFor({ thread: { request_state: 'declined', created_by: THEM } })
    expect(await sendMessageCore(c, { threadId: T, body: 'hi' })).toMatchObject({ ok: true })
  })
})

describe('receipts on a pending incoming request', () => {
  it('markThreadRead clears bell rows but stamps no read_at / delivered_at', async () => {
    const { c, session, adm } = ctxFor({ thread: { request_state: 'pending', created_by: THEM } })
    await markThreadRead(c, T)
    expect(session.calls.some((x) => x.table === 'dm_messages')).toBe(false)
    expect(adm.calls.some((x) => x.table === 'player_notifications')).toBe(true)
  })
  it('markThreadRead stamps receipts on an accepted thread (unchanged behaviour)', async () => {
    const { c, session } = ctxFor({ thread: { request_state: 'accepted', created_by: THEM } })
    await markThreadRead(c, T)
    expect(session.calls.some((x) => x.table === 'dm_messages')).toBe(true)
  })
  it('markThreadRead still stamps receipts for the INITIATOR of a pending thread (their own sent view)', async () => {
    const { c, session } = ctxFor({ thread: { request_state: 'pending', created_by: ME } })
    await markThreadRead(c, T)
    expect(session.calls.some((x) => x.table === 'dm_messages')).toBe(true)
  })
  it('markAllDelivered excludes messages in pending incoming threads', async () => {
    const session = fakeAdmin()
    const adm = fakeAdmin((op) => (op.table === 'dm_threads' ? { data: [{ id: 'p1' }, { id: 'p2' }] } : { data: null }))
    await markAllDelivered({ supabase: session.admin, admin: adm.admin, userId: ME } as never)
    const upd = session.calls.find((x) => x.table === 'dm_messages')
    expect(JSON.stringify(upd?.ops)).toContain('p1')
    expect(JSON.stringify(upd?.ops)).toContain('p2')
  })
  it('markAllDelivered applies no exclusion when there are no pending incoming threads', async () => {
    const session = fakeAdmin()
    const adm = fakeAdmin((op) => (op.table === 'dm_threads' ? { data: [] } : { data: null }))
    await markAllDelivered({ supabase: session.admin, admin: adm.admin, userId: ME } as never)
    const upd = session.calls.find((x) => x.table === 'dm_messages')
    expect(JSON.stringify(upd?.ops)).not.toContain('"not"')
  })
})

describe('accept / decline', () => {
  it('the recipient accepts', async () => {
    const { c, adm } = ctxFor({ thread: { request_state: 'pending', created_by: THEM } })
    expect(await acceptRequest(c, T)).toEqual({ ok: true })
    const upd = adm.calls.find((x) => x.table === 'dm_threads' && x.ops.some(([m]) => m === 'update'))
    expect(JSON.stringify(upd?.ops)).toContain('"request_state":"accepted"')
  })
  it('the initiator cannot accept their own request', async () => {
    const { c } = ctxFor({ thread: { request_state: 'pending', created_by: ME } })
    expect(await acceptRequest(c, T)).toMatchObject({ ok: false, errorCode: 'not_found' })
  })
  it('a non-participant cannot accept or decline', async () => {
    const { c } = ctxFor({ thread: { player_a: 'x', player_b: 'y', created_by: 'x' } as never })
    expect(await acceptRequest(c, T)).toMatchObject({ ok: false, errorCode: 'not_found' })
    expect(await declineRequest(c, T)).toMatchObject({ ok: false, errorCode: 'not_found' })
  })
  it('the recipient declines a pending request, only while pending', async () => {
    const { c, adm } = ctxFor({ thread: { request_state: 'pending', created_by: THEM } })
    expect(await declineRequest(c, T)).toEqual({ ok: true })
    const upd = adm.calls.find((x) => x.table === 'dm_threads' && x.ops.some(([m]) => m === 'update'))
    expect(JSON.stringify(upd?.ops)).toContain('"request_state":"declined"')
    expect(JSON.stringify(upd?.ops)).toContain('"pending"')
  })
  it('accept and decline are idempotent', async () => {
    const acc = ctxFor({ thread: { request_state: 'accepted', created_by: THEM } })
    expect(await acceptRequest(acc.c, T)).toEqual({ ok: true })
    const dec = ctxFor({ thread: { request_state: 'declined', created_by: THEM } })
    expect(await declineRequest(dec.c, T)).toEqual({ ok: true })
  })
  it('declining an already accepted thread does not undo the acceptance', async () => {
    const { c, adm } = ctxFor({ thread: { request_state: 'accepted', created_by: THEM } })
    expect(await declineRequest(c, T)).toEqual({ ok: true })
    expect(adm.calls.some((x) => x.table === 'dm_threads' && x.ops.some(([m]) => m === 'update'))).toBe(false)
  })
})

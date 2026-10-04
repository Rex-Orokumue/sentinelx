import { describe, it, expect, vi } from 'vitest'
import { fakeAdmin, type Op } from '@/lib/notifications/fake-admin'
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn() }))
import { sendClientMessage, forwardMessageCore } from './service'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const thread = { player_a: U, player_b: V }

function ctx(over: (op: Op) => unknown = () => null) {
  const session = fakeAdmin((op) => (op.table === 'dm_messages' ? { data: { id: 'm-new', created_at: '2026-10-05T00:00:00Z' } } : { data: null }))
  const admin = fakeAdmin((op) => {
    const o = over(op)
    if (o) return { data: o }
    if (op.table === 'dm_threads') return { data: thread }
    if (op.table === 'profiles') return { data: { display_name: 'A', username: 'a' } }
    return { data: null }
  })
  return { c: { supabase: session.admin, admin: admin.admin, userId: U } as never, session, admin }
}

describe('sendClientMessage path rule', () => {
  it('rejects an image path from another user', async () => {
    const { c, session } = ctx()
    const res = await sendClientMessage(c, { threadId: 't', imageUrl: `${V}/secret.jpg` })
    expect(res).toMatchObject({ ok: false, errorCode: 'validation', message: 'Invalid attachment.' })
    expect(session.calls.some((x) => x.table === 'dm_messages')).toBe(false)
  })
  it('rejects an audio path from another user', async () => {
    const { c } = ctx()
    const res = await sendClientMessage(c, { threadId: 't', audioUrl: `${V}/v.m4a`, audioDurationSeconds: 5 })
    expect(res).toMatchObject({ ok: false, errorCode: 'validation' })
  })
  it('accepts the caller own folder', async () => {
    const { c } = ctx()
    expect(await sendClientMessage(c, { threadId: 't', imageUrl: `${U}/ok.jpg` })).toMatchObject({ ok: true })
  })
  it('never lets a client claim forwarded', async () => {
    const { c, session } = ctx()
    await sendClientMessage(c, { threadId: 't', body: 'hi', forwarded: true })
    const insert = session.calls.find((x) => x.table === 'dm_messages')
    expect(JSON.stringify(insert?.ops)).toContain('"forwarded":false')
  })
})

describe('forwarding is NOT subject to the path rule (regression guard)', () => {
  it('forwards a received image whose path is in the ORIGINAL sender folder', async () => {
    const { c } = ctx((op) =>
      op.table === 'dm_messages'
        ? { thread_id: 'src', body: null, image_url: `${V}/received.jpg`, sticker_id: null, audio_url: null, audio_duration_seconds: null, deleted_at: null }
        : null,
    )
    expect(await forwardMessageCore(c, { messageId: 'm1', toThreadId: 't' })).toMatchObject({ ok: true })
  })
})

describe('DM push data', () => {
  it('passes the thread id to notifyBoth so a push tap can open the right thread', async () => {
    const { notifyBoth } = await import('@/lib/notifications/send')
    ;(notifyBoth as unknown as { mockClear: () => void }).mockClear()
    const { c } = ctx()
    await sendClientMessage(c, { threadId: 't-xyz', body: 'hello' })
    expect(notifyBoth).toHaveBeenCalledWith(
      V,
      expect.objectContaining({ type: 'direct_message' }),
      'direct_message',
      { link: '/messages/t-xyz', data: { threadId: 't-xyz' } },
    )
  })
})

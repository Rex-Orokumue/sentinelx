import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin, type Op } from '@/lib/notifications/fake-admin'

let sessionFake = fakeAdmin()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: (t: string) => (sessionFake.admin as unknown as { from: (t: string) => unknown }).from(t) }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } }) }))

import { fetchThreadList, fetchThread } from './query'

const ME = 'me'
const row = (id: string, state: string | undefined, createdBy: string) => ({
  id,
  player_a: ME,
  player_b: `other-${id}`,
  last_message_at: '2026-10-05T10:00:00Z',
  request_state: state,
  created_by: createdBy,
})

function useThreads(rows: ReturnType<typeof row>[], single?: ReturnType<typeof row>) {
  sessionFake = fakeAdmin((op: Op) => {
    const isSingle = op.ops.some(([m]) => m === 'maybeSingle')
    if (op.table === 'dm_threads') return { data: isSingle ? (single ?? null) : rows }
    if (op.table === 'profiles') return { data: [] }
    return { data: [] }
  })
}

beforeEach(() => {
  sessionFake = fakeAdmin()
})

describe('fetchThreadList boxes', () => {
  const rows = [
    row('acc', 'accepted', 'x'),
    row('in-pending', 'pending', 'x'),
    row('out-pending', 'pending', ME),
    row('out-declined', 'declined', ME),
    row('in-declined', 'declined', 'x'),
    row('legacy', undefined, 'x'),
  ]
  it('the inbox holds accepted threads and the viewer own pending requests, with their direction', async () => {
    useThreads(rows)
    const list = await fetchThreadList(ME)
    expect(list.map((t) => t.threadId).sort()).toEqual(['acc', 'legacy', 'out-pending'])
    expect(list.find((t) => t.threadId === 'out-pending')).toMatchObject({ requestState: 'pending', direction: 'outgoing' })
    expect(list.find((t) => t.threadId === 'acc')).toMatchObject({ requestState: 'accepted', direction: null })
  })
  it('a thread from before requests existed reads as accepted', async () => {
    useThreads(rows)
    expect((await fetchThreadList(ME)).find((t) => t.threadId === 'legacy')).toMatchObject({ requestState: 'accepted' })
  })
  it('the requests box holds incoming pending threads only', async () => {
    useThreads(rows)
    const list = await fetchThreadList(ME, 'requests')
    expect(list.map((t) => t.threadId)).toEqual(['in-pending'])
    expect(list[0]).toMatchObject({ direction: 'incoming' })
  })
  it('a declined thread is in neither box, for either side (a block hides a thread the same way)', async () => {
    useThreads(rows)
    expect((await fetchThreadList(ME)).some((t) => t.threadId === 'in-declined' || t.threadId === 'out-declined')).toBe(false)
    expect((await fetchThreadList(ME, 'requests')).some((t) => t.threadId === 'in-declined')).toBe(false)
  })
})

describe('fetchThread request info', () => {
  it('exposes the state and who started it', async () => {
    const r = row('t1', 'pending', 'x')
    useThreads([r], r)
    expect(await fetchThread('t1', ME)).toMatchObject({ requestState: 'pending', direction: 'incoming' })
    const mine = row('t2', 'pending', ME)
    useThreads([mine], mine)
    expect(await fetchThread('t2', ME)).toMatchObject({ requestState: 'pending', direction: 'outgoing' })
  })
})

describe('fetchThread for the initiator of a declined request', () => {
  it('reports it as a block, not as a decline', async () => {
    const r = row('t3', 'declined', ME)
    useThreads([r], r)
    expect(await fetchThread('t3', ME)).toMatchObject({ blockedByThem: true, requestState: 'accepted', direction: null })
  })
  it('the recipient keeps the real state', async () => {
    const r = row('t4', 'declined', 'x')
    useThreads([r], r)
    expect(await fetchThread('t4', ME)).toMatchObject({ blockedByThem: false, requestState: 'declined' })
  })
})

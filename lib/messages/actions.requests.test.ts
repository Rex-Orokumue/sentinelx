import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeAdmin } from '@/lib/notifications/fake-admin'

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn() }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInAppOf: vi.fn() }))

let sessionUser: string | null = 'me'
let adminFake = fakeAdmin()
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser } : null } }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake.admin }))

import { acceptMessageRequest, declineMessageRequest } from './actions'

const thread = (over: Record<string, unknown>) =>
  fakeAdmin((op) => (op.table === 'dm_threads' ? { data: { player_a: 'me', player_b: 'them', created_by: 'them', request_state: 'pending', ...over } } : { data: null }))

beforeEach(() => {
  sessionUser = 'me'
  adminFake = thread({})
  revalidatePath.mockClear()
})

describe('acceptMessageRequest / declineMessageRequest actions', () => {
  it('require login', async () => {
    sessionUser = null
    expect(await acceptMessageRequest('t1')).toEqual({ error: 'Please log in.' })
    expect(await declineMessageRequest('t1')).toEqual({ error: 'Please log in.' })
  })
  it('accept succeeds for the recipient and refreshes the inbox and thread', async () => {
    expect(await acceptMessageRequest('t1')).toEqual({})
    expect(revalidatePath).toHaveBeenCalledWith('/messages')
    expect(revalidatePath).toHaveBeenCalledWith('/messages/t1')
  })
  it('decline succeeds for the recipient and refreshes the inbox', async () => {
    expect(await declineMessageRequest('t1')).toEqual({})
    expect(revalidatePath).toHaveBeenCalledWith('/messages')
  })
  it('the initiator cannot answer their own request', async () => {
    adminFake = thread({ created_by: 'me', player_a: 'me', player_b: 'them' })
    expect(await acceptMessageRequest('t1')).toEqual({ error: 'Conversation not found.' })
    expect(await declineMessageRequest('t1')).toEqual({ error: 'Conversation not found.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

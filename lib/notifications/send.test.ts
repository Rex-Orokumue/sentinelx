import { describe, it, expect, vi, beforeEach } from 'vitest'

const { pushToPlayer, notifyInAppOf } = vi.hoisted(() => ({
  pushToPlayer: vi.fn().mockResolvedValue(undefined),
  notifyInAppOf: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./push', () => ({ pushToPlayer }))
vi.mock('./inbox', () => ({ notifyInAppOf }))

import { notifyBoth } from './send'

const input = { type: 'direct_message', fromName: 'Rex', kind: 'text', excerpt: 'hi' } as const

beforeEach(() => {
  pushToPlayer.mockClear()
  notifyInAppOf.mockClear()
})

describe('notifyBoth', () => {
  it('sends the link as the push url and nothing else by default (every other type is unchanged)', async () => {
    await notifyBoth('p1', input, 'direct_message', { link: '/messages/t1' })
    expect(pushToPlayer).toHaveBeenCalledWith('p1', input, { url: '/messages/t1' }, { postId: undefined })
    expect(notifyInAppOf).toHaveBeenCalledWith('p1', input, 'direct_message', '/messages/t1')
  })

  it('merges extra push data alongside the url', async () => {
    await notifyBoth('p1', input, 'direct_message', { link: '/messages/t1', data: { threadId: 't1' } })
    expect(pushToPlayer).toHaveBeenCalledWith('p1', input, { url: '/messages/t1', threadId: 't1' }, { postId: undefined })
  })

  it('never lets extra data override the url', async () => {
    await notifyBoth('p1', input, 'direct_message', { link: '/messages/t1', data: { url: '/evil' } })
    expect(pushToPlayer.mock.calls[0][2]).toEqual({ url: '/messages/t1' })
  })

  it('sends empty data when there is no link', async () => {
    await notifyBoth('p1', input, 'direct_message')
    expect(pushToPlayer.mock.calls[0][2]).toEqual({})
  })
})

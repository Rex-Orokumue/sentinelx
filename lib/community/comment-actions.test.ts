import { describe, it, expect, vi } from 'vitest'

const notifyInApp = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp }))
const pushToPlayer = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer }))

const insertSingle = vi.fn()
const single = vi.fn(() => insertSingle())
const select = vi.fn(() => ({ single }))
const insert = vi.fn(() => ({ select }))
const maybeSingle = vi.fn()
const eqAuthor = vi.fn(() => ({ maybeSingle }))
const selectAuthor = vi.fn(() => ({ eq: eqAuthor }))
const from = vi.fn((table: string) => (table === 'post_comments' ? { insert } : { select: selectAuthor }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'commenter-1' } } }) },
    from,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('createComment notifications', () => {
  it('does not notify when the author comments on their own post', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({ data: { author_id: 'commenter-1', content: 'x' } })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'nice post' })
    expect(notifyInApp).not.toHaveBeenCalled()
    expect(pushToPlayer).not.toHaveBeenCalled()
  })

  it('notifies the post author when someone else comments', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({ data: { author_id: 'author-1', content: 'x' } })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'nice post' })
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'author-1', type: 'post_comment' }))
    expect(pushToPlayer).toHaveBeenCalledWith('author-1', 'post_comment', expect.anything(), expect.anything())
  })
})

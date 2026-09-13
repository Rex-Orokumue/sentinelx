import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// A match_result post has no author, so resolving recipients needs the match
// behind it — fetched through the service-role client.
const matchMaybeSingle = vi.fn().mockResolvedValue({ data: null })
const adminFrom = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: matchMaybeSingle }) }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFrom }) }))

const getStaffIds = vi.fn().mockResolvedValue([])
vi.mock('@/lib/admin/staff', () => ({ getStaffIds }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(() => {
  notifyInApp.mockClear()
  pushToPlayer.mockClear()
  matchMaybeSingle.mockClear()
  matchMaybeSingle.mockResolvedValue({ data: null })
  // mockResolvedValue alone leaves call history intact, so the "does not look
  // up staff" assertion would see the previous test's call.
  getStaffIds.mockClear()
  getStaffIds.mockResolvedValue([])
})

describe('createComment notifications — authored posts', () => {
  it('does not notify when the author comments on their own post', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: 'commenter-1', content: 'x', post_type: 'manual', reference_id: null },
    })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'nice post' })
    expect(notifyInApp).not.toHaveBeenCalled()
    expect(pushToPlayer).not.toHaveBeenCalled()
  })

  it('notifies the post author when someone else comments', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: 'author-1', content: 'x', post_type: 'manual', reference_id: null },
    })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'nice post' })
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'author-1', type: 'post_comment' }))
    expect(pushToPlayer).toHaveBeenCalledWith(
      'author-1',
      expect.objectContaining({ type: 'post_comment' }),
      expect.anything(),
      expect.anything(),
    )
  })
})

// THE BUG: all 116 match_result posts have author_id NULL, and the old guard
// `if (post?.author_id && ...)` skipped the whole block — no push, no in-app
// notification. 87% of the feed notified nobody.
describe('createComment notifications — match results', () => {
  it('notifies both players in the match', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: null, content: 'x', post_type: 'match_result', reference_id: 'match-1' },
    })
    matchMaybeSingle.mockResolvedValueOnce({
      data: { player_a_id: 'player-a', player_b_id: 'player-b' },
    })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'great game' })
    expect(pushToPlayer).toHaveBeenCalledWith(
      'player-a',
      expect.objectContaining({ type: 'post_comment', onMatch: true }),
      expect.anything(),
      expect.anything(),
    )
    expect(pushToPlayer).toHaveBeenCalledWith(
      'player-b',
      expect.objectContaining({ type: 'post_comment', onMatch: true }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('does not notify a match player who is the one commenting', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: null, content: 'x', post_type: 'match_result', reference_id: 'match-1' },
    })
    matchMaybeSingle.mockResolvedValueOnce({
      data: { player_a_id: 'commenter-1', player_b_id: 'player-b' },
    })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'gg' })
    expect(pushToPlayer).toHaveBeenCalledOnce()
    expect(pushToPlayer).toHaveBeenCalledWith(
      'player-b',
      expect.objectContaining({ type: 'post_comment' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('says the comment is on your match, not just "New comment"', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: null, content: 'x', post_type: 'match_result', reference_id: 'match-1' },
    })
    matchMaybeSingle.mockResolvedValueOnce({ data: { player_a_id: 'player-a', player_b_id: null } })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'gg' })
    expect(notifyInApp).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'player-a', title: 'New comment on your match' }),
    )
  })
})

describe('createComment notifications — announcements', () => {
  it('notifies staff, since an announcement has no author', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: null, content: 'x', post_type: 'announcement', reference_id: null },
    })
    getStaffIds.mockResolvedValueOnce(['admin-1', 'mod-1'])
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'question about this' })
    expect(pushToPlayer).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ type: 'post_comment' }),
      expect.anything(),
      expect.anything(),
    )
    expect(pushToPlayer).toHaveBeenCalledWith(
      'mod-1',
      expect.objectContaining({ type: 'post_comment' }),
      expect.anything(),
      expect.anything(),
    )
  })

  // Only announcements pay for the staff lookup.
  it('does not look up staff for a normal post', async () => {
    insertSingle.mockResolvedValueOnce({ data: { id: 'c1' }, error: null })
    maybeSingle.mockResolvedValueOnce({
      data: { author_id: 'author-1', content: 'x', post_type: 'manual', reference_id: null },
    })
    const { createComment } = await import('./comment-actions')
    await createComment({ postId: 'post-1', content: 'hi' })
    expect(getStaffIds).not.toHaveBeenCalled()
  })
})

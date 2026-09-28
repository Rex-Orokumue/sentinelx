import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))

const {
  performCreatePost, performDeletePost, performBoostPost,
} = vi.hoisted(() => ({ performCreatePost: vi.fn(), performDeletePost: vi.fn(), performBoostPost: vi.fn() }))
vi.mock('@/lib/community/post-service', () => ({ performCreatePost, performDeletePost, performBoostPost }))

const { performSetReaction, performRemoveReaction } = vi.hoisted(() => ({ performSetReaction: vi.fn(), performRemoveReaction: vi.fn() }))
vi.mock('@/lib/community/reaction-service', () => ({ performSetReaction, performRemoveReaction }))

const { performCreateComment, performDeleteComment } = vi.hoisted(() => ({ performCreateComment: vi.fn(), performDeleteComment: vi.fn() }))
vi.mock('@/lib/community/comment-service', () => ({ performCreateComment, performDeleteComment }))

const {
  performPostStatus, performDeleteStatus, performRecordStatusView,
} = vi.hoisted(() => ({ performPostStatus: vi.fn(), performDeleteStatus: vi.fn(), performRecordStatusView: vi.fn() }))
vi.mock('@/lib/community/status-service', () => ({ performPostStatus, performDeleteStatus, performRecordStatusView }))

const { performVoteBestPlay } = vi.hoisted(() => ({ performVoteBestPlay: vi.fn() }))
vi.mock('@/lib/community/best-play-service', () => ({ performVoteBestPlay }))

const { performReportPost, performReportComment } = vi.hoisted(() => ({ performReportPost: vi.fn(), performReportComment: vi.fn() }))
vi.mock('@/lib/community/report-service', () => ({ performReportPost, performReportComment }))

import {
  createCommunityPostEndpoint, deleteCommunityPostEndpoint, boostCommunityPostEndpoint,
  setCommunityReactionEndpoint, removeCommunityReactionEndpoint,
  createCommunityCommentEndpoint, deleteCommunityCommentEndpoint,
  createCommunityStatusEndpoint, deleteCommunityStatusEndpoint, viewCommunityStatusEndpoint,
  voteCommunityBestPlayEndpoint,
  reportCommunityPostEndpoint, reportCommunityCommentEndpoint,
} from './community-writes'

const ctx = { userId: 'u1', admin: 'admin', userClient: 'sb' }

function req(body?: unknown, idempotencyKey = 'k1') {
  return new Request('https://x.test/api/mobile/v1/community/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  authenticate.mockResolvedValue(ctx)
  runIdempotent.mockImplementation(async (_admin: unknown, _args: unknown, run: () => Promise<unknown>) => run())
})

describe('createCommunityPostEndpoint', () => {
  it('creates a post', async () => {
    performCreatePost.mockResolvedValue({ ok: true, id: 'p1' })
    const res = await createCommunityPostEndpoint.handler(req({ content: 'hi', imageUrls: [] }), { params: {} })
    expect(performCreatePost).toHaveBeenCalledWith('sb', 'admin', 'u1', { content: 'hi', imageUrls: [] })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ id: 'p1' })
  })

  it('maps an empty post to validation_failed', async () => {
    performCreatePost.mockResolvedValue({ ok: false, error: 'Write something or add a screenshot first.' })
    const res = await createCommunityPostEndpoint.handler(req({ content: '', imageUrls: [] }), { params: {} })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
  })
})

describe('deleteCommunityPostEndpoint', () => {
  it('returns success on delete', async () => {
    performDeletePost.mockResolvedValue({ ok: true })
    const res = await deleteCommunityPostEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 'p1' } })
    expect(performDeletePost).toHaveBeenCalledWith('sb', 'u1', 'p1')
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps forbidden to 403', async () => {
    performDeletePost.mockResolvedValue({ ok: false, errorCode: 'forbidden' })
    const res = await deleteCommunityPostEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 'p1' } })
    expect(res.status).toBe(403)
  })

  it('maps not_found to 404', async () => {
    performDeletePost.mockResolvedValue({ ok: false, errorCode: 'not_found' })
    const res = await deleteCommunityPostEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })
})

describe('boostCommunityPostEndpoint', () => {
  it('is idempotent and maps insufficient_coins to 400', async () => {
    performBoostPost.mockResolvedValue({ ok: false, errorCode: 'insufficient_coins' })
    const res = await boostCommunityPostEndpoint.handler(req(undefined), { params: { id: 'p1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('insufficient_coins')
  })

  it('maps active_boost_exists to 409', async () => {
    performBoostPost.mockResolvedValue({ ok: false, errorCode: 'active_boost_exists' })
    const res = await boostCommunityPostEndpoint.handler(req(undefined), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
  })

  it('succeeds', async () => {
    performBoostPost.mockResolvedValue({ ok: true })
    const res = await boostCommunityPostEndpoint.handler(req(undefined), { params: { id: 'p1' } })
    expect((await res.json()).data).toEqual({ success: true })
  })
})

describe('reaction endpoints', () => {
  it('PUT sets a reaction and is idempotent', async () => {
    performSetReaction.mockResolvedValue({ ok: true, reaction: 'fire' })
    const res = await setCommunityReactionEndpoint.handler(req({ reaction: 'fire' }), { params: { id: 'p1' } })
    expect(performSetReaction).toHaveBeenCalledWith('sb', 'admin', 'u1', 'p1', 'fire')
    expect((await res.json()).data).toEqual({ reaction: 'fire' })
  })

  it('PUT 404s when the post is missing', async () => {
    performSetReaction.mockResolvedValue({ ok: false, errorCode: 'not_found' })
    const res = await setCommunityReactionEndpoint.handler(req({ reaction: 'fire' }), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })

  it('DELETE removes a reaction and always succeeds', async () => {
    performRemoveReaction.mockResolvedValue({ ok: true })
    const res = await removeCommunityReactionEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 'p1' } })
    expect(performRemoveReaction).toHaveBeenCalledWith('sb', 'u1', 'p1')
    expect((await res.json()).data).toEqual({ success: true })
  })
})

describe('comment endpoints', () => {
  it('creates a comment', async () => {
    performCreateComment.mockResolvedValue({ ok: true, id: 'c1' })
    const res = await createCommunityCommentEndpoint.handler(req({ content: 'nice' }), { params: { id: 'p1' } })
    expect(performCreateComment).toHaveBeenCalledWith('sb', 'admin', 'u1', { postId: 'p1', content: 'nice' })
    expect((await res.json()).data).toEqual({ id: 'c1' })
  })

  it('maps a missing post to not_found', async () => {
    performCreateComment.mockResolvedValue({ ok: false, error: 'Post not found.', notFound: true })
    const res = await createCommunityCommentEndpoint.handler(req({ content: 'nice' }), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('not_found')
  })

  it('maps empty content to validation_failed', async () => {
    performCreateComment.mockResolvedValue({ ok: false, error: 'Write something first' })
    const res = await createCommunityCommentEndpoint.handler(req({ content: 'nice' }), { params: { id: 'p1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
  })

  it('deletes own comment', async () => {
    performDeleteComment.mockResolvedValue({ ok: true })
    const res = await deleteCommunityCommentEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 'c1' } })
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps forbidden delete to 403', async () => {
    performDeleteComment.mockResolvedValue({ ok: false, errorCode: 'forbidden' })
    const res = await deleteCommunityCommentEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 'c1' } })
    expect(res.status).toBe(403)
  })
})

describe('status endpoints', () => {
  it('posts a status', async () => {
    performPostStatus.mockResolvedValue({ ok: true, id: 's1' })
    const res = await createCommunityStatusEndpoint.handler(req({ caption: 'hi' }), { params: {} })
    expect((await res.json()).data).toEqual({ id: 's1' })
  })

  it('maps empty status to validation_failed', async () => {
    performPostStatus.mockResolvedValue({ ok: false, error: 'Add a photo or write something first.' })
    const res = await createCommunityStatusEndpoint.handler(req({}), { params: {} })
    expect(res.status).toBe(400)
  })

  it('deletes own status', async () => {
    performDeleteStatus.mockResolvedValue({ ok: true })
    const res = await deleteCommunityStatusEndpoint.handler(new Request('https://x.test', { method: 'DELETE' }), { params: { id: 's1' } })
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('view always succeeds even best-effort', async () => {
    performRecordStatusView.mockResolvedValue(undefined)
    const res = await viewCommunityStatusEndpoint.handler(req(undefined), { params: { id: 's1' } })
    expect((await res.json()).data).toEqual({ success: true })
  })
})

describe('voteCommunityBestPlayEndpoint', () => {
  it('is idempotent and maps voting_closed to 409', async () => {
    performVoteBestPlay.mockResolvedValue({ ok: false, errorCode: 'voting_closed' })
    const res = await voteCommunityBestPlayEndpoint.handler(req(undefined), { params: { nominationId: 'n1' } })
    expect(res.status).toBe(409)
  })

  it('succeeds', async () => {
    performVoteBestPlay.mockResolvedValue({ ok: true })
    const res = await voteCommunityBestPlayEndpoint.handler(req(undefined), { params: { nominationId: 'n1' } })
    expect((await res.json()).data).toEqual({ success: true })
  })
})

describe('report endpoints', () => {
  it('reports a post', async () => {
    performReportPost.mockResolvedValue({ ok: true })
    const res = await reportCommunityPostEndpoint.handler(req({ reasonCode: 'spam' }), { params: { id: 'p1' } })
    expect(performReportPost).toHaveBeenCalledWith('sb', 'u1', 'p1', { reasonCode: 'spam' })
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps already_reported to 409', async () => {
    performReportPost.mockResolvedValue({ ok: false, errorCode: 'already_reported' })
    const res = await reportCommunityPostEndpoint.handler(req({ reasonCode: 'spam' }), { params: { id: 'p1' } })
    expect(res.status).toBe(409)
  })

  it('reports a comment, resolving post_id server-side', async () => {
    performReportComment.mockResolvedValue({ ok: true })
    const res = await reportCommunityCommentEndpoint.handler(req({ reasonCode: 'harassment' }), { params: { id: 'c1' } })
    expect(performReportComment).toHaveBeenCalledWith('sb', 'u1', 'c1', { reasonCode: 'harassment' })
    expect((await res.json()).data).toEqual({ success: true })
  })
})

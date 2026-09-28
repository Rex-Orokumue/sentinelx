import { describe, it, expect, vi, beforeEach } from 'vitest'

const { optionalAuth, authenticate } = vi.hoisted(() => ({ optionalAuth: vi.fn(), authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))

const { fetchFeedPage, fetchPostDetail } = vi.hoisted(() => ({ fetchFeedPage: vi.fn(), fetchPostDetail: vi.fn() }))
vi.mock('@/lib/community/feed-query', () => ({ fetchFeedPage, fetchPostDetail }))

const { fetchChallengeWidget } = vi.hoisted(() => ({ fetchChallengeWidget: vi.fn() }))
vi.mock('@/lib/community/challenge-query', () => ({ fetchChallengeWidget }))

const { fetchBestPlayBanner } = vi.hoisted(() => ({ fetchBestPlayBanner: vi.fn() }))
vi.mock('@/lib/community/best-play-query', () => ({ fetchBestPlayBanner }))

const { fetchStatusRings, fetchStatusViewers } = vi.hoisted(() => ({ fetchStatusRings: vi.fn(), fetchStatusViewers: vi.fn() }))
vi.mock('@/lib/community/status-query', () => ({ fetchStatusRings, fetchStatusViewers }))

const { fetchTopCommunityMembers } = vi.hoisted(() => ({ fetchTopCommunityMembers: vi.fn() }))
vi.mock('@/lib/community/top-members-query', () => ({ fetchTopCommunityMembers }))

const { fetchUpcomingCommunityEvents } = vi.hoisted(() => ({ fetchUpcomingCommunityEvents: vi.fn() }))
vi.mock('@/lib/community/upcoming-events-query', () => ({ fetchUpcomingCommunityEvents }))

const { fetchCommunityGallery } = vi.hoisted(() => ({ fetchCommunityGallery: vi.fn() }))
vi.mock('@/lib/community/gallery-query', () => ({ fetchCommunityGallery }))

const { fetchCommunityStats } = vi.hoisted(() => ({ fetchCommunityStats: vi.fn() }))
vi.mock('@/lib/community/stats-query', () => ({ fetchCommunityStats }))

import {
  communityFeedEndpoint, communityPostDetailEndpoint, communityCommentsEndpoint,
  communityChallengesEndpoint, communityBestPlayEndpoint,
  communityStatusesEndpoint, communityStatusViewersEndpoint,
  communityTopMembersEndpoint, communityUpcomingEventsEndpoint,
  communityGalleryEndpoint, communityStatsEndpoint,
} from './community-reads'

function get(path: string) {
  return new Request(`https://x.test/api/mobile/v1${path}`)
}

const playerRef = {
  id: 'author-1', username: 'ada', displayName: 'Ada', avatarUrl: null,
  membershipTier: 'recruit', sentinelTier: null,
}
const post = {
  id: 'p1', postType: 'manual' as const, content: 'hi', imageUrl: null, imageUrls: [],
  referenceId: null, isPinned: false, boostedUntil: null, createdAt: '2026-09-28T00:00:00Z',
  author: playerRef, canDelete: false, canBoost: false,
  reactionCounts: { fire: 0, crown: 0, strong: 0, wow: 0 }, myReaction: null,
  commentCount: 0, matchResult: null, mutedByViewer: false,
}
const comment = { id: 'c1', content: 'nice', createdAt: '2026-09-28T00:00:00Z', author: playerRef, canDelete: false }
const ring = {
  playerId: 'p1', authorName: 'Ada', authorUsername: 'ada', authorAvatarUrl: null,
  statuses: [], hasUnseen: false, isSelf: false, latestAt: '2026-09-28T00:00:00Z',
}

beforeEach(() => {
  // A guest is still a resolved ctx with userId: null (mirrors bracket.test.ts) —
  // optionalAuth resolving to bare null would fall through to the real
  // createAnonClient(), which needs live Supabase env vars this test suite
  // doesn't set.
  optionalAuth.mockResolvedValue({ userId: null, userClient: 'sb' })
  authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
})

describe('communityFeedEndpoint', () => {
  it('is public and defaults offset/limit for a guest', async () => {
    fetchFeedPage.mockResolvedValue({ pinned: [], posts: [], hasMore: false })
    const res = await communityFeedEndpoint.handler(get('/community/feed'), { params: {} })
    expect(fetchFeedPage).toHaveBeenCalledWith('sb', { offset: 0, limit: 20, viewerId: null })
    expect(res.status).toBe(200)
  })

  it('reads offset/limit query params and the signed-in viewer', async () => {
    optionalAuth.mockResolvedValue({ userId: 'u1', userClient: 'sb' })
    fetchFeedPage.mockResolvedValue({ pinned: [], posts: [], hasMore: true })
    await communityFeedEndpoint.handler(get('/community/feed?offset=20&limit=10'), { params: {} })
    expect(fetchFeedPage).toHaveBeenCalledWith('sb', { offset: 20, limit: 10, viewerId: 'u1' })
  })
})

describe('communityPostDetailEndpoint', () => {
  it('404s when the post is missing', async () => {
    fetchPostDetail.mockResolvedValue(null)
    const res = await communityPostDetailEndpoint.handler(get('/community/posts/p1'), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })

  it('returns the post and comments', async () => {
    const result = { post, comments: [comment] }
    fetchPostDetail.mockResolvedValue(result)
    const res = await communityPostDetailEndpoint.handler(get('/community/posts/p1'), { params: { id: 'p1' } })
    expect((await res.json()).data).toEqual(result)
  })
})

describe('communityCommentsEndpoint', () => {
  it('returns only the comments half of fetchPostDetail', async () => {
    fetchPostDetail.mockResolvedValue({ post, comments: [comment] })
    const res = await communityCommentsEndpoint.handler(get('/community/posts/p1/comments'), { params: { id: 'p1' } })
    expect((await res.json()).data).toEqual({ comments: [comment] })
  })

  it('404s when the post is missing', async () => {
    fetchPostDetail.mockResolvedValue(null)
    const res = await communityCommentsEndpoint.handler(get('/community/posts/p1/comments'), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })
})

describe('communityChallengesEndpoint', () => {
  it('requires auth and passes the viewer id', async () => {
    expect(communityChallengesEndpoint.meta.auth).toBe('user')
    fetchChallengeWidget.mockResolvedValue({ weekLabel: 'x', challenges: [] })
    await communityChallengesEndpoint.handler(get('/community/challenges'), { params: {} })
    expect(fetchChallengeWidget).toHaveBeenCalledWith('u1')
  })
})

describe('communityBestPlayEndpoint', () => {
  it('is public and can return null (voting window closed)', async () => {
    fetchBestPlayBanner.mockResolvedValue(null)
    const res = await communityBestPlayEndpoint.handler(get('/community/best-play'), { params: {} })
    expect((await res.json()).data).toBeNull()
  })
})

describe('communityStatusesEndpoint', () => {
  it('returns rings', async () => {
    fetchStatusRings.mockResolvedValue([ring])
    const res = await communityStatusesEndpoint.handler(get('/community/statuses'), { params: {} })
    expect((await res.json()).data).toEqual({ rings: [ring] })
  })
})

describe('communityStatusViewersEndpoint', () => {
  it('requires auth and uses the caller\'s own RLS-scoped client', async () => {
    expect(communityStatusViewersEndpoint.meta.auth).toBe('user')
    fetchStatusViewers.mockResolvedValue([])
    await communityStatusViewersEndpoint.handler(get('/community/statuses/s1/viewers'), { params: { id: 's1' } })
    expect(fetchStatusViewers).toHaveBeenCalledWith('sb', 's1')
  })
})

describe('communityTopMembersEndpoint', () => {
  it('returns members', async () => {
    fetchTopCommunityMembers.mockResolvedValue([])
    const res = await communityTopMembersEndpoint.handler(get('/community/top-members'), { params: {} })
    expect((await res.json()).data).toEqual({ members: [] })
  })
})

describe('communityUpcomingEventsEndpoint', () => {
  it('returns events', async () => {
    fetchUpcomingCommunityEvents.mockResolvedValue([])
    const res = await communityUpcomingEventsEndpoint.handler(get('/community/upcoming-events'), { params: {} })
    expect((await res.json()).data).toEqual({ events: [] })
  })
})

describe('communityGalleryEndpoint', () => {
  it('defaults limit to 8', async () => {
    fetchCommunityGallery.mockResolvedValue({ items: [], hasMore: false })
    await communityGalleryEndpoint.handler(get('/community/gallery'), { params: {} })
    expect(fetchCommunityGallery).toHaveBeenCalledWith(0, 8)
  })
})

describe('communityStatsEndpoint', () => {
  it('returns stats', async () => {
    fetchCommunityStats.mockResolvedValue({ memberCount: 1, countryCount: 1, tournamentCount: 1 })
    const res = await communityStatsEndpoint.handler(get('/community/stats'), { params: {} })
    expect((await res.json()).data).toEqual({ memberCount: 1, countryCount: 1, tournamentCount: 1 })
  })
})

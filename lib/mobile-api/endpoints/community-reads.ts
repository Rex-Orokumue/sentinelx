import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { fetchFeedPage, fetchPostDetail } from '@/lib/community/feed-query'
import { fetchChallengeWidget } from '@/lib/community/challenge-query'
import { fetchBestPlayBanner } from '@/lib/community/best-play-query'
import { fetchStatusRings, fetchStatusViewers } from '@/lib/community/status-query'
import { fetchTopCommunityMembers } from '@/lib/community/top-members-query'
import { fetchUpcomingCommunityEvents } from '@/lib/community/upcoming-events-query'
import { fetchCommunityGallery } from '@/lib/community/gallery-query'
import { fetchCommunityStats } from '@/lib/community/stats-query'
import { REACTIONS } from '@/lib/community/schema'

const PAGE_SIZE = 20

const playerRef = z.object({
  id: z.string().nullable(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  membershipTier: z.string(),
  sentinelTier: z.string().nullable(),
  frameUrl: z.string().optional(),
})
const matchResultDetail = z.object({
  matchId: z.string(),
  tournamentTitle: z.string(),
  roundLabel: z.string(),
  scoreA: z.number().nullable(),
  scoreB: z.number().nullable(),
  playerA: playerRef.nullable(),
  playerB: playerRef.nullable(),
  scheduledAt: z.string().nullable(),
})
const reactionCounts = z.object(Object.fromEntries(REACTIONS.map((r) => [r, z.number()])) as Record<(typeof REACTIONS)[number], z.ZodNumber>)
const postView = z.object({
  id: z.string(),
  postType: z.enum(['manual', 'match_result', 'achievement', 'announcement']),
  content: z.string(),
  imageUrl: z.string().nullable(),
  imageUrls: z.array(z.string()),
  referenceId: z.string().nullable(),
  isPinned: z.boolean(),
  boostedUntil: z.string().nullable(),
  createdAt: z.string(),
  author: playerRef,
  canDelete: z.boolean(),
  canBoost: z.boolean(),
  reactionCounts,
  myReaction: z.enum(REACTIONS).nullable(),
  commentCount: z.number(),
  matchResult: matchResultDetail.nullable(),
  mutedByViewer: z.boolean(),
})
const commentView = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.string(),
  author: playerRef,
  canDelete: z.boolean(),
})

const offsetLimitParams = [
  { name: 'offset', in: 'query' as const, schema: { type: 'integer', minimum: 0, default: 0 } },
  { name: 'limit', in: 'query' as const, schema: { type: 'integer', minimum: 1, maximum: 50, default: PAGE_SIZE } },
]
function parseOffsetLimit(req: Request, defaultLimit = PAGE_SIZE) {
  const sp = new URL(req.url).searchParams
  const offset = z.coerce.number().int().min(0).catch(0).parse(sp.get('offset') ?? 0)
  const limit = z.coerce.number().int().min(1).max(50).catch(defaultLimit).parse(sp.get('limit') ?? defaultLimit)
  return { offset, limit }
}

export const communityFeedEndpoint = defineEndpoint({
  operationId: 'getCommunityFeed',
  method: 'GET',
  path: '/community/feed',
  summary: 'Pinned + boosted + paginated community feed posts.',
  auth: 'public',
  parameters: offsetLimitParams,
  response: z.object({ pinned: z.array(postView), posts: z.array(postView), hasMore: z.boolean() }),
  handler: async ({ ctx, req }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { offset, limit } = parseOffsetLimit(req)
    return fetchFeedPage(supabase, { offset, limit, viewerId: ctx?.userId ?? null })
  },
})

export const communityPostDetailEndpoint = defineEndpoint({
  operationId: 'getCommunityPost',
  method: 'GET',
  path: '/community/posts/{id}',
  summary: 'One post plus its comments (same PostView shape as the feed).',
  auth: 'public',
  response: z.object({ post: postView, comments: z.array(commentView) }),
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const result = await fetchPostDetail(supabase, params.id, ctx?.userId ?? null)
    if (!result) throw Errors.notFound()
    return result
  },
})

export const communityCommentsEndpoint = defineEndpoint({
  operationId: 'getCommunityPostComments',
  method: 'GET',
  path: '/community/posts/{id}/comments',
  summary: "A post's comments (author join, is_deleted filtered, chronological — capped at 50).",
  auth: 'public',
  response: z.object({ comments: z.array(commentView) }),
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const result = await fetchPostDetail(supabase, params.id, ctx?.userId ?? null)
    if (!result) throw Errors.notFound()
    return { comments: result.comments }
  },
})

const challengeProgress = z.object({
  slug: z.string(), title: z.string(), description: z.string(), goal: z.number(),
  progress: z.number(), completed: z.boolean(), coinReward: z.number(), xpReward: z.number(),
})
export const communityChallengesEndpoint = defineEndpoint({
  operationId: 'getCommunityChallenges',
  method: 'GET',
  path: '/community/challenges',
  summary: "This week's community challenges and the caller's progress.",
  auth: 'user',
  response: z.object({ weekLabel: z.string(), challenges: z.array(challengeProgress) }).nullable(),
  handler: async ({ ctx }) => fetchChallengeWidget(ctx.userId),
})

const bestPlayNomination = z.object({ nominationId: z.string(), postId: z.string(), content: z.string(), authorName: z.string(), voteCount: z.number() })
export const communityBestPlayEndpoint = defineEndpoint({
  operationId: 'getCommunityBestPlay',
  method: 'GET',
  path: '/community/best-play',
  summary: 'Best Play of the Week banner — nominations, vote tallies, and the caller\'s own vote, when the voting window is open.',
  auth: 'public',
  response: z.object({ nominations: z.array(bestPlayNomination), myVoteNominationId: z.string().nullable() }).nullable(),
  handler: async ({ ctx }) => fetchBestPlayBanner(ctx?.userId ?? null),
})

const statusRow = z.object({
  id: z.string(), playerId: z.string(), imageUrl: z.string().nullable(), caption: z.string().nullable(),
  createdAt: z.string(), expiresAt: z.string(), authorName: z.string(), authorUsername: z.string().nullable(), authorAvatarUrl: z.string().nullable(),
})
const statusRing = z.object({
  playerId: z.string(), authorName: z.string(), authorUsername: z.string().nullable(), authorAvatarUrl: z.string().nullable(),
  statuses: z.array(statusRow), hasUnseen: z.boolean(), isSelf: z.boolean(), latestAt: z.string(),
})
export const communityStatusesEndpoint = defineEndpoint({
  operationId: 'getCommunityStatuses',
  method: 'GET',
  path: '/community/statuses',
  summary: 'Live (24h) status rings for the story tray, grouped and ordered per player.',
  auth: 'public',
  response: z.object({ rings: z.array(statusRing) }),
  handler: async ({ ctx }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    return { rings: await fetchStatusRings(supabase, ctx?.userId ?? null) }
  },
})

const statusViewer = z.object({ viewerId: z.string(), name: z.string(), username: z.string().nullable(), avatarUrl: z.string().nullable(), viewedAt: z.string() })
export const communityStatusViewersEndpoint = defineEndpoint({
  operationId: 'getCommunityStatusViewers',
  method: 'GET',
  path: '/community/statuses/{id}/viewers',
  summary: "A status's viewer list — server-enforced to the status's own author (RLS returns empty for anyone else).",
  auth: 'user',
  response: z.object({ viewers: z.array(statusViewer) }),
  handler: async ({ ctx, params }) => ({ viewers: await fetchStatusViewers(ctx.userClient, params.id) }),
})

const topMember = z.object({
  rank: z.number(), id: z.string(), username: z.string().nullable(), displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(), membershipTier: z.string(), xp: z.number(), frameUrl: z.string().optional(),
})
export const communityTopMembersEndpoint = defineEndpoint({
  operationId: 'getCommunityTopMembers',
  method: 'GET',
  path: '/community/top-members',
  summary: 'Top 5 members by XP.',
  auth: 'public',
  response: z.object({ members: z.array(topMember) }),
  handler: async () => ({ members: await fetchTopCommunityMembers(5) }),
})

const upcomingEvent = z.object({ id: z.string(), title: z.string(), date: z.string(), time: z.string(), ctaLabel: z.string(), ctaHref: z.string() })
export const communityUpcomingEventsEndpoint = defineEndpoint({
  operationId: 'getCommunityUpcomingEvents',
  method: 'GET',
  path: '/community/upcoming-events',
  summary: 'Upcoming tournaments shown as community events.',
  auth: 'public',
  response: z.object({ events: z.array(upcomingEvent) }),
  handler: async () => ({ events: await fetchUpcomingCommunityEvents(3) }),
})

const galleryItem = z.object({ id: z.string(), imageUrl: z.string(), caption: z.string(), authorName: z.string() })
export const communityGalleryEndpoint = defineEndpoint({
  operationId: 'getCommunityGallery',
  method: 'GET',
  path: '/community/gallery',
  summary: 'Most recent posts with an image, for the gallery grid.',
  auth: 'public',
  parameters: offsetLimitParams,
  response: z.object({ items: z.array(galleryItem), hasMore: z.boolean() }),
  handler: async ({ req }) => {
    const { offset, limit } = parseOffsetLimit(req, 8)
    return fetchCommunityGallery(offset, limit)
  },
})

export const communityStatsEndpoint = defineEndpoint({
  operationId: 'getCommunityStats',
  method: 'GET',
  path: '/community/stats',
  summary: 'Member/country/tournament counts for the community stats bar.',
  auth: 'public',
  response: z.object({ memberCount: z.number(), countryCount: z.number(), tournamentCount: z.number() }),
  handler: async () => fetchCommunityStats(),
})

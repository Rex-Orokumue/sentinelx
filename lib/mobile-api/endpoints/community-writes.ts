import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performCreatePost, performDeletePost, performBoostPost, type DeletePostErrorCode, type BoostPostErrorCode } from '@/lib/community/post-service'
import { performSetReaction, performRemoveReaction } from '@/lib/community/reaction-service'
import { performCreateComment, performDeleteComment, type DeleteCommentErrorCode } from '@/lib/community/comment-service'
import { performPostStatus, performDeleteStatus, performRecordStatusView, type DeleteStatusErrorCode } from '@/lib/community/status-service'
import { performVoteBestPlay, type VoteBestPlayErrorCode } from '@/lib/community/best-play-service'
import { performReportPost, performReportComment, type ReportErrorCode } from '@/lib/community/report-service'
import { REACTIONS } from '@/lib/community/schema'

const successResponse = z.object({ success: z.literal(true) })

// --- posts ---

export const createCommunityPostEndpoint = defineEndpoint({
  operationId: 'postCommunityPost',
  method: 'POST',
  path: '/community/posts',
  summary: 'Create a manual community post (text and/or up to 5 images).',
  auth: 'user',
  idempotent: true,
  body: z.object({ content: z.string().trim().max(500), imageUrls: z.array(z.string()).max(5).default([]) }),
  response: z.object({ id: z.string() }),
  handler: async ({ ctx, body }) => {
    const result = await performCreatePost(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(400, 'validation_failed', result.error)
    return { id: result.id }
  },
})

const DELETE_POST_STATUS: Record<DeletePostErrorCode, number> = { not_found: 404, forbidden: 403 }
const DELETE_POST_MESSAGE: Record<DeletePostErrorCode, string> = {
  not_found: 'Post not found.',
  forbidden: 'You can only delete your own post.',
}
export const deleteCommunityPostEndpoint = defineEndpoint({
  operationId: 'deleteCommunityPost',
  method: 'DELETE',
  path: '/community/posts/{id}',
  summary: 'Delete (soft) your own post. Naturally idempotent, author-only.',
  auth: 'user',
  response: successResponse,
  handler: async ({ ctx, params }) => {
    const result = await performDeletePost(ctx.userClient, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(DELETE_POST_STATUS[result.errorCode], result.errorCode, DELETE_POST_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

const BOOST_STATUS: Record<BoostPostErrorCode, number> = {
  not_found: 404, already_boosted: 409, active_boost_exists: 409, insufficient_coins: 400, boost_failed: 500,
}
const BOOST_MESSAGE: Record<BoostPostErrorCode, string> = {
  not_found: 'You can only boost your own post.',
  already_boosted: 'This post is already boosted.',
  active_boost_exists: 'You already have an active boost on another post.',
  insufficient_coins: 'Not enough SX Coins to boost.',
  boost_failed: 'Could not boost this post. Please try again.',
}
export const boostCommunityPostEndpoint = defineEndpoint({
  operationId: 'postCommunityPostBoost',
  method: 'POST',
  path: '/community/posts/{id}/boost',
  summary: 'Boost your own manual post to the top of the feed for 24h (200 coins).',
  auth: 'user',
  idempotent: true,
  response: successResponse,
  handler: async ({ ctx, params }) => {
    const result = await performBoostPost(ctx.admin, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(BOOST_STATUS[result.errorCode], result.errorCode, BOOST_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

// --- reactions ---
// Ruling 6: a genuine set-idempotent PUT + a naturally-idempotent DELETE,
// not web's single toggle action — see reaction-service.ts.

export const setCommunityReactionEndpoint = defineEndpoint({
  operationId: 'putCommunityPostReaction',
  method: 'PUT',
  path: '/community/posts/{id}/reaction',
  summary: 'Set the caller\'s reaction on a post. Idempotent — replaying the same reaction is a no-op.',
  auth: 'user',
  idempotent: true,
  body: z.object({ reaction: z.enum(REACTIONS) }),
  response: z.object({ reaction: z.enum(REACTIONS) }),
  handler: async ({ ctx, params, body }) => {
    const result = await performSetReaction(ctx.userClient, ctx.admin, ctx.userId, params.id, body.reaction)
    if (!result.ok) throw new ApiError(404, 'not_found', 'Post not found.')
    return { reaction: result.reaction }
  },
})

export const removeCommunityReactionEndpoint = defineEndpoint({
  operationId: 'deleteCommunityPostReaction',
  method: 'DELETE',
  path: '/community/posts/{id}/reaction',
  summary: "Remove the caller's reaction on a post. Naturally idempotent.",
  auth: 'user',
  response: successResponse,
  handler: async ({ ctx, params }) => {
    await performRemoveReaction(ctx.userClient, ctx.userId, params.id)
    return { success: true as const }
  },
})

// --- comments ---

export const createCommunityCommentEndpoint = defineEndpoint({
  operationId: 'postCommunityComment',
  method: 'POST',
  path: '/community/posts/{id}/comments',
  summary: 'Create a flat (non-threaded) comment on a post.',
  auth: 'user',
  idempotent: true,
  body: z.object({ content: z.string().trim().min(1).max(280) }),
  response: z.object({ id: z.string() }),
  handler: async ({ ctx, params, body }) => {
    const result = await performCreateComment(ctx.userClient, ctx.admin, ctx.userId, { postId: params.id, content: body.content })
    if (!result.ok) throw new ApiError(result.notFound ? 404 : 400, result.notFound ? 'not_found' : 'validation_failed', result.error)
    return { id: result.id }
  },
})

const DELETE_COMMENT_STATUS: Record<DeleteCommentErrorCode, number> = { not_found: 404, forbidden: 403 }
const DELETE_COMMENT_MESSAGE: Record<DeleteCommentErrorCode, string> = {
  not_found: 'Comment not found.',
  forbidden: 'You can only delete your own comment.',
}
export const deleteCommunityCommentEndpoint = defineEndpoint({
  operationId: 'deleteCommunityComment',
  method: 'DELETE',
  path: '/community/comments/{id}',
  summary: 'Delete (soft) your own comment. Naturally idempotent, author-only.',
  auth: 'user',
  response: successResponse,
  handler: async ({ ctx, params }) => {
    const result = await performDeleteComment(ctx.userClient, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(DELETE_COMMENT_STATUS[result.errorCode], result.errorCode, DELETE_COMMENT_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

// --- statuses ---

export const createCommunityStatusEndpoint = defineEndpoint({
  operationId: 'postCommunityStatus',
  method: 'POST',
  path: '/community/statuses',
  summary: 'Post a 24h status (image and/or caption — at least one required).',
  auth: 'user',
  idempotent: true,
  body: z.object({ imageUrl: z.string().optional(), caption: z.string().optional() }),
  response: z.object({ id: z.string() }),
  handler: async ({ ctx, body }) => {
    const result = await performPostStatus(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(400, 'validation_failed', result.error)
    return { id: result.id }
  },
})

const DELETE_STATUS_STATUS: Record<DeleteStatusErrorCode, number> = { not_found: 404, forbidden: 403 }
const DELETE_STATUS_MESSAGE: Record<DeleteStatusErrorCode, string> = {
  not_found: 'That status is already gone.',
  forbidden: 'You can only delete your own status.',
}
export const deleteCommunityStatusEndpoint = defineEndpoint({
  operationId: 'deleteCommunityStatus',
  method: 'DELETE',
  path: '/community/statuses/{id}',
  summary: 'Delete your own status. Naturally idempotent, author-only.',
  auth: 'user',
  response: successResponse,
  handler: async ({ ctx, params }) => {
    const result = await performDeleteStatus(ctx.userClient, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(DELETE_STATUS_STATUS[result.errorCode], result.errorCode, DELETE_STATUS_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

export const viewCommunityStatusEndpoint = defineEndpoint({
  operationId: 'postCommunityStatusView',
  method: 'POST',
  path: '/community/statuses/{id}/view',
  summary: 'Mark a status viewed. Best-effort — always succeeds; naturally idempotent by construction.',
  auth: 'user',
  response: successResponse,
  handler: async ({ ctx, params }) => {
    await performRecordStatusView(ctx.userClient, ctx.admin, ctx.userId, params.id)
    return { success: true as const }
  },
})

// --- best play ---

const VOTE_STATUS: Record<VoteBestPlayErrorCode, number> = { not_found: 404, voting_closed: 409, already_voted: 409 }
const VOTE_MESSAGE: Record<VoteBestPlayErrorCode, string> = {
  not_found: 'Nomination not found.',
  voting_closed: 'Voting is closed right now.',
  already_voted: "You've already voted this week.",
}
export const voteCommunityBestPlayEndpoint = defineEndpoint({
  operationId: 'postCommunityBestPlayVote',
  method: 'POST',
  path: '/community/best-play/{nominationId}/vote',
  summary: 'Vote for a Best Play of the Week nomination — one vote per player per week.',
  auth: 'user',
  idempotent: true,
  response: successResponse,
  handler: async ({ ctx, params }) => {
    const result = await performVoteBestPlay(ctx.userClient, ctx.userId, params.nominationId)
    if (!result.ok) throw new ApiError(VOTE_STATUS[result.errorCode], result.errorCode, VOTE_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

// --- report ---

const reportBody = z.object({
  reasonCode: z.enum(['spam', 'harassment', 'hate_speech', 'nudity_or_sexual_content', 'violence', 'misinformation', 'other']),
  note: z.string().trim().max(500).optional(),
})
const REPORT_STATUS: Record<ReportErrorCode, number> = { not_found: 404, already_reported: 409, report_failed: 500 }
const REPORT_MESSAGE: Record<ReportErrorCode, string> = {
  not_found: 'Not found.',
  already_reported: "You've already reported this.",
  report_failed: 'Could not submit your report. Please try again.',
}

export const reportCommunityPostEndpoint = defineEndpoint({
  operationId: 'postCommunityPostReport',
  method: 'POST',
  path: '/community/posts/{id}/report',
  summary: 'Report a post to staff.',
  auth: 'user',
  idempotent: true,
  body: reportBody,
  response: successResponse,
  handler: async ({ ctx, params, body }) => {
    const result = await performReportPost(ctx.userClient, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(REPORT_STATUS[result.errorCode], result.errorCode, REPORT_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

export const reportCommunityCommentEndpoint = defineEndpoint({
  operationId: 'postCommunityCommentReport',
  method: 'POST',
  path: '/community/comments/{id}/report',
  summary: 'Report a comment to staff. post_id is resolved server-side, never trusted from the client.',
  auth: 'user',
  idempotent: true,
  body: reportBody,
  response: successResponse,
  handler: async ({ ctx, params, body }) => {
    const result = await performReportComment(ctx.userClient, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(REPORT_STATUS[result.errorCode], result.errorCode, REPORT_MESSAGE[result.errorCode])
    return { success: true as const }
  },
})

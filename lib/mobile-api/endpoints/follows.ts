import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import { followPlayer, unfollowPlayer, type FollowClient } from '@/lib/follows/service'
import { findLiveProfileByUsername } from '@/lib/players/find-by-username'
import { fetchFollowingIds, fetchFollowerIds } from '@/lib/follows/query'
import { notifyBoth } from '@/lib/notifications/send'

export const myFollowsEndpoint = defineEndpoint({
  operationId: 'getMyFollows',
  method: 'GET',
  path: '/me/follows',
  summary: "The signed-in player's own follow sets. The app derives 'Following' and 'Follows you' from this — public responses never carry viewer state.",
  auth: 'user',
  cacheControl: 'no-store',
  response: z.object({ followingIds: z.array(z.string()), followerIds: z.array(z.string()) }).strict(),
  handler: async ({ ctx }) => ({
    followingIds: await fetchFollowingIds(ctx.userId, ctx.userClient),
    followerIds: await fetchFollowerIds(ctx.userId, ctx.userClient),
  }),
})

async function targetId(client: FollowClient, username: string): Promise<string> {
  const t = await findLiveProfileByUsername<{ id: string; deleted_at: string | null }>(client, username, 'id, username, deleted_at')
  if (!t) throw Errors.notFound()
  return t.id
}

// Runs on ctx.userClient (RLS), never the service role: the dm_blocks policy is the block mechanism and must keep applying.
export const followEndpoint = defineEndpoint({
  operationId: 'followPlayer',
  method: 'PUT',
  path: '/players/{username}/follow',
  summary: 'Follow a player. Idempotent: a replay returns the stored response and sends no second notification. `created` is false when already following.',
  auth: 'user',
  idempotent: true,
  cacheControl: 'no-store',
  response: z.object({ following: z.literal(true), created: z.boolean() }).strict(),
  handler: async ({ ctx, params }) => {
    const id = await targetId(ctx.userClient, params.username)
    const pending: Promise<unknown>[] = []
    const r = await followPlayer(ctx.userClient, ctx.userId, id, {
      notify: (...args) => {
        pending.push(Promise.resolve(notifyBoth(...args)))
      },
    })
    // Serverless may freeze un-awaited work once the response is sent; a failed notification must not fail the follow.
    await Promise.allSettled(pending)
    if (!r.ok) {
      if (r.code === 'self') throw new ApiError(400, 'cannot_follow_self', 'You cannot follow yourself.')
      if (r.code === 'blocked') throw new ApiError(403, 'follow_blocked', 'You cannot follow this player.')
      throw new ApiError(500, 'follow_failed', 'Could not follow this player.')
    }
    return { following: true as const, created: r.created }
  },
})

export const unfollowEndpoint = defineEndpoint({
  operationId: 'unfollowPlayer',
  method: 'DELETE',
  path: '/players/{username}/follow',
  summary: 'Unfollow a player. Naturally idempotent.',
  auth: 'user',
  cacheControl: 'no-store',
  response: z.object({ following: z.literal(false) }).strict(),
  handler: async ({ ctx, params }) => {
    const id = await targetId(ctx.userClient, params.username)
    const r = await unfollowPlayer(ctx.userClient, ctx.userId, id)
    if (!r.ok) throw new ApiError(500, 'unfollow_failed', 'Could not unfollow this player.')
    return { following: false as const }
  },
})

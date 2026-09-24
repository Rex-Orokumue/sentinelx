import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { Errors } from '../errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlayerProfile, searchPlayers } from '@/lib/players/service'
import { findLiveProfileByUsername } from '@/lib/players/find-by-username'
import { fetchFollowers, fetchFollowing } from '@/lib/follows/query'
import {
  publicProfileSchema, playerListItemSchema, followEntrySchema,
  mapPublicProfile, mapPlayerListItem, mapFollowEntry,
} from './players-schemas'

// Public endpoints never look at the caller (the handlers ignore ctx): bodies are byte-identical for everyone, so
// they are safely edge-cacheable. Viewer state ("following", "follows you") comes from GET /me/follows.
const CACHE = 'public, s-maxage=60, stale-while-revalidate=120'

export const playersSearchEndpoint = defineEndpoint({
  operationId: 'searchPlayers',
  method: 'GET',
  path: '/players',
  summary:
    'Player directory search (max 60, ranked by SX Score). Public. Unlike the web page it cannot exclude the signed-in viewer (responses are identical for everyone) — the app filters its own username.',
  auth: 'public',
  cacheControl: CACHE,
  response: z.array(playerListItemSchema),
  handler: async ({ req }) => {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 64)
    const rows = await searchPlayers(createAnonClient(), q, null)
    // Deleted accounts are tombstones with no username: the web directory has no filter for them (left as is),
    // but a card without a handle cannot link anywhere, so the API drops it.
    return rows.filter((r) => r.username).map(mapPlayerListItem)
  },
})

export const playerProfileEndpoint = defineEndpoint({
  operationId: 'getPlayerProfile',
  method: 'GET',
  path: '/players/{username}',
  summary:
    'Public player profile. 404 for unknown and deleted accounts. Locked achievements are never described — only total/unlockedCount. Identical for every caller.',
  auth: 'public',
  cacheControl: CACHE,
  response: publicProfileSchema,
  handler: async ({ params }) => {
    // viewerId is null on purpose: no owner-only branch may ever run on the public path.
    const data = await getPlayerProfile(createAnonClient(), () => createAdminClient(), params.username, null)
    if (!data) throw Errors.notFound()
    return mapPublicProfile(data)
  },
})

async function listFor(kind: 'followers' | 'following', username: string) {
  const client = createAnonClient()
  const p = await findLiveProfileByUsername<{ id: string; deleted_at: string | null }>(
    client,
    username,
    'id, username, display_name, deleted_at',
  )
  if (!p) throw Errors.notFound()
  const entries = kind === 'followers' ? await fetchFollowers(p.id, 100, client) : await fetchFollowing(p.id, 100, client)
  return entries.map(mapFollowEntry)
}

export const playerFollowersEndpoint = defineEndpoint({
  operationId: 'getPlayerFollowers',
  method: 'GET',
  path: '/players/{username}/followers',
  summary: 'Who follows this player (max 100, newest first). Public.',
  auth: 'public',
  cacheControl: CACHE,
  response: z.array(followEntrySchema),
  handler: async ({ params }) => listFor('followers', params.username),
})

export const playerFollowingEndpoint = defineEndpoint({
  operationId: 'getPlayerFollowing',
  method: 'GET',
  path: '/players/{username}/following',
  summary: 'Who this player follows (max 100, newest first). Public.',
  auth: 'public',
  cacheControl: CACHE,
  response: z.array(followEntrySchema),
  handler: async ({ params }) => listFor('following', params.username),
})

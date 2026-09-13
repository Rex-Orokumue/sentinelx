import { createClient } from '@/lib/supabase/server'
import { safeCount } from './predicates'

export async function fetchFollowCounts(profileId: string): Promise<{ followers: number; following: number }> {
  const supabase = createClient()
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from('player_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', profileId),
    supabase.from('player_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', profileId),
  ])
  return { followers: safeCount(followers), following: safeCount(following) }
}

export async function fetchIsFollowing(viewerId: string, profileId: string): Promise<boolean> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_follows')
    .select('follower_id')
    .eq('follower_id', viewerId)
    .eq('following_id', profileId)
    .maybeSingle()
  return !!data
}

// Every profile the viewer follows — used to drive the feed's "Following"
// tab. Unbounded: a player following thousands of others is not a case this
// platform has, and the feed filter only needs id membership.
export async function fetchFollowingIds(viewerId: string): Promise<string[]> {
  const supabase = createClient()
  const { data } = await supabase.from('player_follows').select('following_id').eq('follower_id', viewerId)
  return (data ?? []).map((r) => r.following_id)
}

export interface FollowListEntry {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  membershipTier: string
}

type ProfileRow = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  membership_tier: string
}
type ProfileRef = ProfileRow | ProfileRow[] | null
function firstProfile(p: ProfileRef): ProfileRow | null {
  return Array.isArray(p) ? (p[0] ?? null) : p
}
function toEntry(p: ProfileRow | null): FollowListEntry | null {
  if (!p) return null
  return { id: p.id, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url, membershipTier: p.membership_tier }
}

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, membership_tier'

// Who follows profileId. Capped at `limit` (default 100) — the follower/
// following list pages are the spec's named "cuttable corner"; a single
// uncapped page is enough for v1 rather than building full pagination.
export async function fetchFollowers(profileId: string, limit = 100): Promise<FollowListEntry[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_follows')
    .select(`follower:profiles!player_follows_follower_id_fkey(${PROFILE_FIELDS})`)
    .eq('following_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown as { follower: ProfileRef }[])
    .map((r) => toEntry(firstProfile(r.follower)))
    .filter((e): e is FollowListEntry => e !== null)
}

// Who profileId follows.
export async function fetchFollowing(profileId: string, limit = 100): Promise<FollowListEntry[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_follows')
    .select(`following:profiles!player_follows_following_id_fkey(${PROFILE_FIELDS})`)
    .eq('follower_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown as { following: ProfileRef }[])
    .map((r) => toEntry(firstProfile(r.following)))
    .filter((e): e is FollowListEntry => e !== null)
}

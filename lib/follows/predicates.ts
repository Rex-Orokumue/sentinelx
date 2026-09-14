export function canFollow(followerId: string, followingId: string): { ok: true } | { ok: false; error: string } {
  if (followerId === followingId) return { ok: false, error: 'You cannot follow yourself.' }
  return { ok: true }
}

export interface FollowRow {
  followerId: string
  followingId: string
}

export function isFollowing(rows: FollowRow[], followerId: string, followingId: string): boolean {
  return rows.some((r) => r.followerId === followerId && r.followingId === followingId)
}

// Supabase types a head-count query's result as `number | null` — this is the
// one place that coercion happens, so every caller gets a definite number.
export function safeCount(count: number | null): number {
  return count ?? 0
}

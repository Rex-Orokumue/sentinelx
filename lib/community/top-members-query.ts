import { createClient } from '@/lib/supabase/server'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface TopMemberView {
  rank: number
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  membershipTier: MembershipTier
  xp: number
}

// 🥇🥈🥉 for the podium, plain rank number after — spec §4.5.
export function rankIcon(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}

// Top players by XP (profiles.xp, descending). Real tier labels
// (Recruit/Guardian/Elite/Sentinel/Legend) are used, not the mockup's
// fictional ones (spec §4.5).
export async function fetchTopCommunityMembers(limit = 5): Promise<TopMemberView[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, membership_tier, xp')
    .order('xp', { ascending: false })
    .limit(limit)

  return (data ?? []).map((row, i) => ({
    rank: i + 1,
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    membershipTier: (row.membership_tier ?? 'recruit') as MembershipTier,
    xp: row.xp,
  }))
}

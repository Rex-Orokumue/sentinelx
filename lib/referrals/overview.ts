import type { createAdminClient } from '@/lib/supabase/admin'
import { frameUrlFor } from '@/lib/store/cosmetics'
import { SITE_URL } from '@/lib/seo/site'
import type { MembershipTier } from '@/lib/membership/tiers'
import { REFERRAL_MILESTONES } from './constants'

type Admin = ReturnType<typeof createAdminClient>

interface ReferredProfile {
  username: string | null
  display_name: string | null
  avatar_url: string | null
  membership_tier: string | null
  equipped_avatar_border: string | null
}

interface ReferralRow {
  id: string
  status: string
  created_at: string
  converted_at: string | null
  coins_awarded: number | null
  referred: ReferredProfile | ReferredProfile[] | null
}

export interface ReferralOverview {
  username: string | null
  shareUrl: string | null
  totalReferrals: number
  convertedCount: number
  totalCoinsEarned: number
  nextMilestone: { count: number; bonusCoins: number | null } | null
  invited: {
    id: string
    name: string
    avatarUrl: string | null
    tier: MembershipTier
    frameUrl: string | null
    status: 'pending' | 'converted' | 'invalid'
    date: string
    coinsAwarded: number | null
  }[]
  milestoneHistory: { id: string; description: string; coins: number; date: string }[]
}

export type ReferralOverviewResult =
  | { ok: true; value: ReferralOverview }
  | { ok: false; reason: 'not_found' | 'load_failed' }

function firstProfile(value: ReferralRow['referred']): ReferredProfile | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function getReferralOverview(admin: Admin, userId: string): Promise<ReferralOverviewResult> {
  const [profileRes, referralsRes, coinRes, historyRes, achievementsRes] = await Promise.all([
    admin.from('profiles').select('username').eq('id', userId).maybeSingle(),
    admin.from('referrals')
      .select('id, status, created_at, converted_at, coins_awarded, referred:profiles!referrals_referred_id_fkey(username, display_name, avatar_url, membership_tier, equipped_avatar_border)')
      .eq('referrer_id', userId).order('created_at', { ascending: false }),
    admin.from('sx_coin_transactions').select('amount').eq('player_id', userId).in('source', ['referral_reward', 'referral_milestone']),
    admin.from('sx_coin_transactions').select('id, amount, description, created_at').eq('player_id', userId).eq('source', 'referral_milestone').order('created_at', { ascending: true }),
    admin.from('achievements').select('slug, coin_reward').in('slug', REFERRAL_MILESTONES.map((m) => m.achievementSlug)),
  ])

  if (profileRes.error || referralsRes.error || coinRes.error || historyRes.error || achievementsRes.error) {
    return { ok: false, reason: 'load_failed' }
  }
  if (!profileRes.data) return { ok: false, reason: 'not_found' }

  const referrals = (referralsRes.data ?? []) as unknown as ReferralRow[]
  const invited = referrals.map((r) => {
    const p = firstProfile(r.referred)
    return {
      id: r.id,
      name: p?.display_name ?? p?.username ?? 'Player',
      avatarUrl: p?.avatar_url ?? null,
      tier: (p?.membership_tier ?? 'recruit') as MembershipTier,
      frameUrl: frameUrlFor(p?.equipped_avatar_border) ?? null,
      status: r.status as ReferralOverview['invited'][number]['status'],
      date: r.converted_at ?? r.created_at,
      coinsAwarded: r.coins_awarded,
    }
  })
  const convertedCount = invited.filter((r) => r.status === 'converted').length
  const next = REFERRAL_MILESTONES.find((m) => m.count > convertedCount)
  const bonusBySlug = new Map((achievementsRes.data ?? []).map((a) => [a.slug, a.coin_reward]))
  const username = profileRes.data.username
  return {
    ok: true,
    value: {
      username,
      shareUrl: username ? `${SITE_URL.replace(/\/$/, '')}/signup?ref=${encodeURIComponent(username)}` : null,
      totalReferrals: invited.length,
      convertedCount,
      totalCoinsEarned: (coinRes.data ?? []).reduce((sum, row) => sum + row.amount, 0),
      nextMilestone: next ? { count: next.count, bonusCoins: bonusBySlug.get(next.achievementSlug) ?? null } : null,
      invited,
      milestoneHistory: (historyRes.data ?? []).map((row) => ({
        id: row.id,
        description: row.description ?? 'Referral milestone bonus',
        coins: row.amount,
        date: row.created_at,
      })),
    },
  }
}

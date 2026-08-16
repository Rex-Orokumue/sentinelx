import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ReferralPanel, type ReferredPlayer, type MilestoneHistoryEntry } from '@/components/dashboard/ReferralPanel'
import { REFERRAL_MILESTONES } from '@/lib/referrals/constants'

export const metadata: Metadata = { title: 'Referrals · SentinelX Esports', robots: { index: false, follow: false } }

type ReferredRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null; membership_tier: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null; membership_tier: string | null }[]
  | null
function firstRef(r: ReferredRef) {
  return Array.isArray(r) ? (r[0] ?? null) : r
}

export default async function DashboardReferralsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/referrals')

  const admin = createAdminClient()
  const [profileRes, referralsRes, coinTxRes, milestoneTxRes, milestoneAchievementsRes] = await Promise.all([
    admin.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    admin
      .from('referrals')
      .select(
        'id, status, created_at, converted_at, coins_awarded, referred:profiles!referrals_referred_id_fkey(username, display_name, avatar_url, membership_tier)',
      )
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false }),
    admin
      .from('sx_coin_transactions')
      .select('amount')
      .eq('player_id', user.id)
      .in('source', ['referral_reward', 'referral_milestone']),
    admin
      .from('sx_coin_transactions')
      .select('id, amount, description, created_at')
      .eq('player_id', user.id)
      .eq('source', 'referral_milestone')
      .order('created_at', { ascending: true }),
    admin
      .from('achievements')
      .select('slug, coin_reward')
      .in(
        'slug',
        REFERRAL_MILESTONES.map((m) => m.achievementSlug),
      ),
  ])

  const referredPlayers: ReferredPlayer[] = ((referralsRes.data ?? []) as unknown[]).map((raw) => {
    const r = raw as {
      id: string
      status: string
      created_at: string
      converted_at: string | null
      coins_awarded: number | null
      referred: ReferredRef
    }
    const p = firstRef(r.referred)
    return {
      id: r.id,
      name: p?.display_name ?? p?.username ?? 'Player',
      avatarUrl: p?.avatar_url ?? null,
      tier: (p?.membership_tier ?? 'recruit') as ReferredPlayer['tier'],
      status: r.status as 'pending' | 'converted' | 'invalid',
      date: r.converted_at ?? r.created_at,
      coinsAwarded: r.coins_awarded,
    }
  })

  const totalReferrals = referredPlayers.length
  const convertedCount = referredPlayers.filter((r) => r.status === 'converted').length
  const totalCoinsEarned = ((coinTxRes.data ?? []) as { amount: number }[]).reduce((sum, t) => sum + t.amount, 0)
  const milestoneHistory: MilestoneHistoryEntry[] = (
    (milestoneTxRes.data ?? []) as { id: string; amount: number; description: string | null; created_at: string }[]
  ).map((t) => ({
    id: t.id,
    description: t.description ?? 'Referral milestone bonus',
    coins: t.amount,
    date: t.created_at,
  }))

  const bonusBySlug = new Map(((milestoneAchievementsRes.data ?? []) as { slug: string; coin_reward: number }[]).map((a) => [a.slug, a.coin_reward]))
  const nextMilestone = REFERRAL_MILESTONES.find((m) => m.count > convertedCount) ?? null
  const nextMilestoneBonusCoins = nextMilestone ? (bonusBySlug.get(nextMilestone.achievementSlug) ?? null) : null

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Referrals</h1>
      <ReferralPanel
        username={profileRes.data?.username ?? ''}
        totalReferrals={totalReferrals}
        convertedCount={convertedCount}
        totalCoinsEarned={totalCoinsEarned}
        nextMilestoneCount={nextMilestone?.count ?? null}
        nextMilestoneBonusCoins={nextMilestoneBonusCoins}
        referredPlayers={referredPlayers}
        milestoneHistory={milestoneHistory}
      />
    </DashboardShell>
  )
}

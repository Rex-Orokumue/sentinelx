import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ReferralPanel } from '@/components/dashboard/ReferralPanel'
import { getReferralOverview } from '@/lib/referrals/overview'

export const metadata: Metadata = { title: 'Referrals · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardReferralsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/referrals')

  const result = await getReferralOverview(createAdminClient(), user.id)
  if (!result.ok) throw new Error('Could not load referrals')
  const overview = result.value

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Referrals</h1>
      <ReferralPanel
        username={overview.username ?? ''}
        totalReferrals={overview.totalReferrals}
        convertedCount={overview.convertedCount}
        totalCoinsEarned={overview.totalCoinsEarned}
        nextMilestoneCount={overview.nextMilestone?.count ?? null}
        nextMilestoneBonusCoins={overview.nextMilestone?.bonusCoins ?? null}
        referredPlayers={overview.invited}
        milestoneHistory={overview.milestoneHistory}
      />
    </DashboardShell>
  )
}

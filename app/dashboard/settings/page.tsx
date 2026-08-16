import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ProfileForm } from '@/components/settings/ProfileForm'
import { NotificationPrefsForm } from '@/components/settings/NotificationPrefsForm'
import { AchievementSharingForm } from '@/components/settings/AchievementSharingForm'
import { AccountSection } from '@/components/settings/AccountSection'
import type { MembershipTier } from '@/lib/membership/tiers'

export const metadata: Metadata = { title: 'Settings · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardSettingsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/settings')

  const [{ data: row }, { data: kyc }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, username, avatar_url, membership_tier, whatsapp_number, country, bio, kyc_verified, username_changed_at, notification_prefs')
      .eq('id', user.id)
      .maybeSingle(),
    createAdminClient().from('player_kyc').select('kyc_status').eq('player_id', user.id).maybeSingle(),
  ])

  const prefs = (row?.notification_prefs ?? {}) as {
    whatsapp?: Record<string, boolean>
    achievement_sharing?: Record<string, boolean>
  }

  return (
    <DashboardShell>
      <h1 className="mb-4 text-lg font-bold text-white">Settings</h1>
      <div className="space-y-5">
        <ProfileForm
          profile={{
            displayName: row?.display_name ?? null,
            username: row?.username ?? '',
            usernameChangedAt: row?.username_changed_at ?? null,
            avatarUrl: row?.avatar_url ?? null,
            membershipTier: (row?.membership_tier ?? 'recruit') as MembershipTier,
            whatsapp: row?.whatsapp_number ?? null,
            country: row?.country ?? null,
            bio: row?.bio ?? null,
          }}
        />
        <NotificationPrefsForm
          prefs={{
            match_reminder: prefs.whatsapp?.match_reminder ?? true,
            result_confirmed: prefs.whatsapp?.result_confirmed ?? true,
            prize_credited: prefs.whatsapp?.prize_credited ?? true,
            challenge_completed: prefs.whatsapp?.challenge_completed ?? false,
            achievement_unlocked: prefs.whatsapp?.achievement_unlocked ?? false,
            registration_confirmed: prefs.whatsapp?.registration_confirmed ?? true,
          }}
          whatsappNumber={row?.whatsapp_number ?? null}
        />
        <AchievementSharingForm
          prefs={{
            tournament: prefs.achievement_sharing?.tournament ?? true,
            milestone: prefs.achievement_sharing?.milestone ?? true,
            streak: prefs.achievement_sharing?.streak ?? true,
            social: prefs.achievement_sharing?.social ?? false,
            other: prefs.achievement_sharing?.other ?? false,
          }}
        />
        <AccountSection email={user.email ?? ''} kycVerified={kyc?.kyc_status === 'verified' || !!row?.kyc_verified} />
      </div>
    </DashboardShell>
  )
}

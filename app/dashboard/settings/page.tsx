import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ProfileForm } from '@/components/settings/ProfileForm'
import { NotificationPrefsForm } from '@/components/settings/NotificationPrefsForm'
import { PushPrefsForm } from '@/components/settings/PushPrefsForm'
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

  const [{ data: row }, { data: kyc }, { count: fcmTokenCount }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, username, avatar_url, membership_tier, whatsapp_number, country, bio, kyc_verified, username_changed_at, notification_prefs')
      .eq('id', user.id)
      .maybeSingle(),
    createAdminClient().from('player_kyc').select('kyc_status').eq('player_id', user.id).maybeSingle(),
    // Whether push shows "Enabled" — a stored token is the only reliable
    // signal, since Notification.permission alone can't be revoked from JS
    // (it would still read 'granted' even after the player clicked
    // Disable and their token was deleted).
    supabase.from('fcm_tokens').select('id', { count: 'exact', head: true }).eq('player_id', user.id),
  ])

  const prefs = (row?.notification_prefs ?? {}) as {
    whatsapp?: Record<string, boolean>
    push?: Record<string, boolean>
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
        <PushPrefsForm
          prefs={{
            match_reminder: prefs.push?.match_reminder ?? true,
            result_confirmed: prefs.push?.result_confirmed ?? true,
            achievement_unlocked: prefs.push?.achievement_unlocked ?? true,
            challenge_completed: prefs.push?.challenge_completed ?? true,
            new_announcement: prefs.push?.new_announcement ?? true,
            tournament_announced: prefs.push?.tournament_announced ?? true,
            wager_settled: prefs.push?.wager_settled ?? true,
            referral_converted: prefs.push?.referral_converted ?? true,
            post_comment: prefs.push?.post_comment ?? true,
            post_reaction: prefs.push?.post_reaction ?? false,
            bracket_released: prefs.push?.bracket_released ?? true,
            match_assigned: prefs.push?.match_assigned ?? true,
            prize_credited: prefs.push?.prize_credited ?? true,
          }}
          enabled={(fcmTokenCount ?? 0) > 0}
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

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { ProfileForm } from '@/components/settings/ProfileForm'
import { NotificationPrefsForm } from '@/components/settings/NotificationPrefsForm'
import { PushPrefsForm } from '@/components/settings/PushPrefsForm'
import { ALWAYS_MUTED_UNTIL } from '@/lib/notifications/mutes'
import { AchievementSharingForm } from '@/components/settings/AchievementSharingForm'
import { AccountSection } from '@/components/settings/AccountSection'
import { hasPasswordIdentity } from '@/lib/auth/reauth'
import type { MembershipTier } from '@/lib/membership/tiers'

export const metadata: Metadata = { title: 'Settings · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardSettingsPage({
  searchParams,
}: {
  searchParams: { email?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/settings')

  const [{ data: row }, { data: kyc }, { count: fcmTokenCount }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, username, avatar_url, membership_tier, whatsapp_number, country, bio, kyc_verified, username_changed_at, notification_prefs, deletion_requested_at')
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

  // Live type mutes only — a lapsed one shows as unmuted with nothing having
  // to clean it up. A permanent "always" mute lives in prefs.push instead, and
  // is surfaced here as a far-future timestamp so the row renders one way.
  const { data: muteRows } = await supabase
    .from('notification_mutes')
    .select('notification_type, muted_until')
    .eq('player_id', user.id)
    .not('notification_type', 'is', null)
    .gt('muted_until', new Date().toISOString())
  const mutedTypes: Record<string, string> = {}
  for (const m of muteRows ?? []) {
    if (m.notification_type) mutedTypes[m.notification_type] = m.muted_until
  }
  for (const [key, value] of Object.entries(prefs.push ?? {})) {
    if (value === false) mutedTypes[key] = ALWAYS_MUTED_UNTIL
  }

  return (
    <DashboardShell>
      <h1 className="mb-4 text-lg font-bold text-white">Settings</h1>
      <div className="space-y-5">
        <div id="guide-target-profile">
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
        </div>
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
            post_reaction: prefs.push?.post_reaction ?? true,
            bracket_released: prefs.push?.bracket_released ?? true,
            match_assigned: prefs.push?.match_assigned ?? true,
            prize_credited: prefs.push?.prize_credited ?? true,
          }}
          enabled={(fcmTokenCount ?? 0) > 0}
          mutedTypes={mutedTypes}
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
        <AccountSection
          email={user.email ?? ''}
          kycVerified={kyc?.kyc_status === 'verified' || !!row?.kyc_verified}
          username={row?.username ?? null}
          deletionRequestedAt={row?.deletion_requested_at ?? null}
          // Supabase parks a requested address here until its link is opened;
          // user.email stays on the old one until then.
          pendingEmail={user.new_email ?? null}
          hasPassword={hasPasswordIdentity(user)}
          // Set by resolveCallbackRedirect when /auth/confirm verifies an
          // email_change link.
          emailJustChanged={searchParams.email === 'changed'}
        />
      </div>
    </DashboardShell>
  )
}

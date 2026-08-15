import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileEditForm } from '@/components/dashboard/ProfileEditForm'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Profile Settings · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardProfilePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/profile')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username, avatar_url, whatsapp_number, country, bio, phone_verified_at')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Profile Settings</h1>
      <ProfileEditForm
        profile={{
          displayName: profile?.display_name ?? null,
          username: profile?.username ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          whatsapp: profile?.whatsapp_number ?? null,
          country: profile?.country ?? null,
          bio: profile?.bio ?? null,
          phoneVerifiedAt: profile?.phone_verified_at ?? null,
        }}
      />
    </DashboardShell>
  )
}

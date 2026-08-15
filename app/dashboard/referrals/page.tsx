import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ReferralPanel } from '@/components/dashboard/ReferralPanel'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Referrals · SentinelX Esports', robots: { index: false, follow: false } }

type ReferredRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function referredName(r: ReferredRef): string {
  const p = Array.isArray(r) ? r[0] ?? null : r
  return p?.display_name ?? p?.username ?? 'Player'
}

export default async function DashboardReferralsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/referrals')

  const [profileRes, referralsRes] = await Promise.all([
    supabase.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    supabase
      .from('referrals')
      .select('referred:profiles!referrals_referred_id_fkey(username, display_name)')
      .eq('referrer_id', user.id),
  ])

  const referredPlayers = ((referralsRes.data as unknown[] | null) ?? []).map((raw) =>
    referredName((raw as { referred: ReferredRef }).referred),
  )

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Referrals</h1>
      <ReferralPanel username={profileRes.data?.username ?? ''} referredPlayers={referredPlayers} />
    </DashboardShell>
  )
}

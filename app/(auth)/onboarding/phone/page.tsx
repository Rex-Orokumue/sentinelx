import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { OnboardingPhoneClient } from './OnboardingPhoneClient'

export const metadata: Metadata = { title: 'Verify your phone · SentinelX Esports' }

export default async function OnboardingPhonePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/phone')

  const { data: profile } = await supabase
    .from('profiles')
    .select('phone_verified_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.phone_verified_at) redirect('/dashboard')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Verify your phone</h1>
      <p className="mb-6 text-sm text-slate-400">
        We&apos;ll send a 6-digit code on WhatsApp so we can reach you about fixtures and results.
      </p>
      <OnboardingPhoneClient />
    </div>
  )
}

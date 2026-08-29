import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ClaimUsernameForm } from '@/components/onboarding/ClaimUsernameForm'

export const metadata: Metadata = { title: 'Choose your username · SentinelX Esports' }

export default async function ClaimUsernamePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.username) redirect('/dashboard')

  // Email signups carry the handle picked in the wizard as signup metadata
  // (see migration 073) — pre-fill it so the common case is a single tap.
  const desired = user.user_metadata?.username
  const defaultUsername = typeof desired === 'string' ? desired : ''

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Choose your handle</h1>
      <p className="mb-6 text-sm text-slate-400">This is your public username on SentinelX Esports.</p>
      <ClaimUsernameForm defaultUsername={defaultUsername} />
    </div>
  )
}

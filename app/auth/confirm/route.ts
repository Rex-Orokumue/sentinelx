import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCallbackRedirect } from '@/lib/auth/redirect'

// Server-side verification for email links (signup confirmation + password
// recovery). Supabase email templates point here with a token_hash + type;
// verifyOtp establishes the session via cookies — no URL fragment, no PKCE
// code_verifier, no same-browser requirement.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next')

  if (token_hash && type) {
    const supabase = createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      if (type === 'signup' && data.user) {
        await creditReferralIfAny(data.user.id)
      }
      return NextResponse.redirect(`${origin}${resolveCallbackRedirect({ type, next })}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}

// The ₦100 referral credit fires here — at confirmed email, not raw signup
// — so an abandoned/unverified signup never credits anyone. Uses the
// service-role client since referrals has no client INSERT policy at all.
// Idempotent via referrals.referred_id's UNIQUE constraint: a 23505 here
// means this user was already credited (e.g. confirm route hit twice) and
// is safe to ignore.
async function creditReferralIfAny(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('referred_by')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.referred_by) return

  const { error } = await admin
    .from('referrals')
    .insert({ referrer_id: profile.referred_by, referred_id: userId })
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('[auth/confirm] referral credit failed', {
      userId,
      code: (error as { code?: string }).code,
      message: error.message,
    })
  }
}

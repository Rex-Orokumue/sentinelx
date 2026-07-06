import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
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
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${resolveCallbackRedirect({ type, next })}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}

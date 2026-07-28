import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveCallbackRedirect } from '@/lib/auth/redirect'

// OAuth (Google, etc.) callback — DIFFERENT from app/auth/confirm/route.ts.
// Google's redirect carries a PKCE `code` param that a server route CAN
// read, so exchangeCodeForSession is the correct call here. This is NOT the
// pattern CLAUDE.md warns against — that warning is specifically about the
// email confirm/recovery link flow, which returns tokens in the URL
// fragment (unreadable server-side) and must keep using verifyOtp with a
// token_hash instead. Do not merge these two routes.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${resolveCallbackRedirect({ type: null, next })}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`)
}

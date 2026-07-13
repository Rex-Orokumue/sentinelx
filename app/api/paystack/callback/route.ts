import { NextRequest, NextResponse } from 'next/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// Paystack redirects the *user's browser* here with ?reference= after checkout.
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get('reference')
  const origin = req.nextUrl.origin
  if (!reference) {
    return NextResponse.redirect(new URL('/tournaments', origin))
  }

  const result = await confirmRegistration(reference)
  if (result !== 'not_found') {
    const db = createAdminClient()
    const { data } = await db
      .from('tournament_registrations')
      .select('tournaments(slug)')
      .eq('paystack_reference', reference)
      .maybeSingle()
    const slug = (data?.tournaments as { slug: string } | null)?.slug
    const success = result === 'confirmed' || result === 'already_paid'
    const dest = slug ? `/tournaments/${slug}?${success ? 'paid=1' : 'payment=failed'}` : '/tournaments'
    return NextResponse.redirect(new URL(dest, origin))
  }

  // Not a tournament registration reference — try a friendly-match stake.
  const friendlyResult = await confirmFriendlyStake(reference)
  const db = createAdminClient()
  const { data: byChallenger } = await db
    .from('friendly_matches')
    .select('id')
    .eq('challenger_paystack_reference', reference)
    .maybeSingle()
  const { data: byOpponent } = byChallenger
    ? { data: null }
    : await db
        .from('friendly_matches')
        .select('id')
        .eq('opponent_paystack_reference', reference)
        .maybeSingle()
  const matchId = byChallenger?.id ?? byOpponent?.id
  const success = friendlyResult === 'confirmed' || friendlyResult === 'already_paid'
  const dest = matchId
    ? `/dashboard/friendlies/${matchId}?${success ? 'paid=1' : 'payment=failed'}`
    : '/dashboard'
  return NextResponse.redirect(new URL(dest, origin))
}

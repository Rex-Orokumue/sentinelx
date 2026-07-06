import { NextRequest, NextResponse } from 'next/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
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

  // Resolve the slug so we can land the user back on the tournament page.
  const db = createAdminClient()
  const { data } = await db
    .from('tournament_registrations')
    .select('tournaments(slug)')
    .eq('paystack_reference', reference)
    .maybeSingle()
  const slug = (data?.tournaments as { slug: string } | null)?.slug

  const success = result === 'confirmed' || result === 'already_paid'
  const dest = slug
    ? `/tournaments/${slug}?${success ? 'paid=1' : 'payment=failed'}`
    : '/tournaments'
  return NextResponse.redirect(new URL(dest, origin))
}

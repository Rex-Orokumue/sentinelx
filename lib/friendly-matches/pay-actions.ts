'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { initializeTransaction, buildFriendlyStakeReference } from '@/lib/paystack/server'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type PayStakeState = { error?: string } | undefined

export async function payStake(_prev: PayStakeState, formData: FormData): Promise<PayStakeState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, stake_amount, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this challenge can pay.' }
  }
  if (fm.status !== 'awaiting_payment') return { error: 'This challenge is not awaiting payment.' }
  if (!fm.stake_amount) return { error: 'This is a free friendly — no payment needed.' }

  const isChallenger = user.id === fm.challenger_id
  const reference = buildFriendlyStakeReference(id, user.id)
  if (isChallenger) {
    await supabase.from('friendly_matches').update({ challenger_paystack_reference: reference }).eq('id', id)
  } else {
    await supabase.from('friendly_matches').update({ opponent_paystack_reference: reference }).eq('id', id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: fm.stake_amount * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { friendly_match_id: id, player_id: user.id },
    })
  } catch (err) {
    console.error('[payStake] Paystack initialize failed', {
      id,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}

'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildFriendlyStakeReference } from '@/lib/paystack/server'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'

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
    .select('challenger_id, opponent_id, stake_amount, stake_currency, status, challenger_paid, opponent_paid')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this challenge can pay.' }
  }
  if (fm.status !== 'awaiting_payment') return { error: 'This challenge is not awaiting payment.' }
  if (!fm.stake_amount || !fm.stake_currency) return { error: 'This is a free friendly — no payment needed.' }

  const isChallenger = user.id === fm.challenger_id

  // Coins settle instantly — no external redirect/webhook needed, unlike
  // the Paystack path below.
  if (fm.stake_currency === 'coins') {
    const admin = createAdminClient()
    const balance = await getCoinBalance(admin, user.id)
    if (balance < fm.stake_amount) return { error: 'Not enough SX Coins for this stake.' }
    await recordCoinTransaction(admin, user.id, -fm.stake_amount, 'friendly_stake', id, `Friendly stake — match ${id}`)

    const otherPaid = isChallenger ? fm.opponent_paid : fm.challenger_paid
    const nextStatus = otherPaid ? 'active' : 'awaiting_payment'
    await admin
      .from('friendly_matches')
      .update(isChallenger ? { challenger_paid: true, status: nextStatus } : { opponent_paid: true, status: nextStatus })
      .eq('id', id)

    revalidatePath(`/dashboard/friendlies/${id}`)
    return undefined
  }

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

'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { referralWithdrawalSchema } from './schema'
import { computeReferralBalance, REFERRAL_MIN_COUNT } from './balance'

export type ReferralWithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestReferralWithdrawal(
  _prev: ReferralWithdrawalState,
  formData: FormData,
): Promise<ReferralWithdrawalState> {
  const parsed = referralWithdrawalSchema.safeParse({ amount: formData.get('amount') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to request a withdrawal.' }

  const { data: kyc } = await supabase
    .from('player_kyc')
    .select('kyc_status, payout_bank_name, payout_account_number, payout_account_name')
    .eq('player_id', user.id)
    .maybeSingle()
  if (
    kyc?.kyc_status !== 'verified' ||
    !kyc.payout_bank_name ||
    !kyc.payout_account_number ||
    !kyc.payout_account_name
  ) {
    return { error: 'Verify your identity before requesting a withdrawal.' }
  }

  const [{ count: referralCount }, { data: existingRequests }] = await Promise.all([
    supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id),
    supabase.from('referral_withdrawal_requests').select('status, amount').eq('player_id', user.id),
  ])

  const count = referralCount ?? 0
  if (count < REFERRAL_MIN_COUNT) {
    return { error: `Refer at least ${REFERRAL_MIN_COUNT} players before requesting a withdrawal.` }
  }

  const balance = computeReferralBalance(count, existingRequests ?? [])
  if (parsed.data.amount > balance) {
    return { error: 'That amount is more than your available referral balance.' }
  }

  const { error } = await supabase.from('referral_withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: kyc.payout_bank_name,
    account_number: kyc.payout_account_number,
    account_name: kyc.payout_account_name,
    status: 'pending',
  })

  if (error) {
    // Partial unique index (one pending request per player) surfaces as 23505.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending referral withdrawal request.' }
    }
    console.error('requestReferralWithdrawal: insert failed', error)
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

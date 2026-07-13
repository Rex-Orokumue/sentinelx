'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { friendlyWithdrawalSchema } from './schema'
import { computeStakedBalance } from './balance'

export type FriendlyWithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestFriendlyWithdrawal(
  _prev: FriendlyWithdrawalState,
  formData: FormData,
): Promise<FriendlyWithdrawalState> {
  const parsed = friendlyWithdrawalSchema.safeParse({ amount: formData.get('amount') })
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

  const [{ data: wins }, { data: existingRequests }] = await Promise.all([
    supabase.from('friendly_matches').select('stake_amount').eq('winner_id', user.id).eq('status', 'completed').not('stake_amount', 'is', null),
    supabase.from('friendly_withdrawal_requests').select('status, amount').eq('player_id', user.id),
  ])

  const balance = computeStakedBalance(
    (wins ?? []).map((w) => ({ stakeAmount: w.stake_amount as number })),
    existingRequests ?? [],
  )
  if (parsed.data.amount > balance) {
    return { error: 'That amount is more than your available staked-match balance.' }
  }

  const { error } = await supabase.from('friendly_withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: kyc.payout_bank_name,
    account_number: kyc.payout_account_number,
    account_name: kyc.payout_account_name,
    status: 'pending',
  })
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending staked-match withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

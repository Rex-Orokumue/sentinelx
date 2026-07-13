'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { walletWithdrawalSchema } from './schema'
import { getWalletBalance, debitWallet } from './service'

export type WalletWithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestWalletWithdrawal(
  _prev: WalletWithdrawalState,
  formData: FormData,
): Promise<WalletWithdrawalState> {
  const parsed = walletWithdrawalSchema.safeParse({ amount: formData.get('amount') })
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

  const admin = createAdminClient()
  const balance = await getWalletBalance(admin, user.id)
  if (parsed.data.amount > balance) {
    return { error: 'That amount is more than your available balance.' }
  }

  const { data: inserted, error } = await admin
    .from('withdrawal_requests')
    .insert({
      player_id: user.id,
      amount: parsed.data.amount,
      bank_name: kyc.payout_bank_name,
      account_number: kyc.payout_account_number,
      account_name: kyc.payout_account_name,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !inserted) {
    if ((error as { code?: string })?.code === '23505') {
      return { error: 'You already have a pending withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  const debit = await debitWallet(admin, user.id, parsed.data.amount, 'withdrawal_request', inserted.id)
  if (!debit.ok) {
    // Race: balance dropped between the pre-check above and now (e.g. two
    // tabs submitting at once). Undo the insert so the player never sees a
    // pending request that was never actually debited.
    await admin.from('withdrawal_requests').delete().eq('id', inserted.id)
    return { error: 'That amount is more than your available balance.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { walletWithdrawalSchema } from './schema'
import { submitWithdrawal } from './withdrawal-service'
import { RESTRICTION_MESSAGE } from '@/lib/settings/restriction'

export type WalletWithdrawalState = { error?: string; success?: boolean } | undefined

const WITHDRAWAL_ERRORS = {
  pending_deletion: RESTRICTION_MESSAGE,
  kyc_required: 'Verify your identity before requesting a withdrawal.',
  insufficient_balance: 'That amount is more than your available balance.',
  withdrawal_pending: 'You already have a pending withdrawal request.',
  failed: 'Could not submit your request. Please try again.',
} as const

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

  const result = await submitWithdrawal(createAdminClient(), { playerId: user.id, amount: parsed.data.amount })
  if (!result.ok) return { error: WITHDRAWAL_ERRORS[result.reason] }

  revalidatePath('/dashboard')
  return { success: true }
}

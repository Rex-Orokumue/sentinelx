'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { walletDepositSchema } from './schema'
import { startDeposit } from './deposit-service'
import { RESTRICTION_MESSAGE } from '@/lib/settings/restriction'

export type WalletDepositState = { error?: string } | undefined

const DEPOSIT_ERRORS = {
  pending_deletion: RESTRICTION_MESSAGE,
  insert_failed: 'Could not start your top-up. Please try again.',
  paystack_failed: 'Payment could not be started. Please try again.',
  email_required: 'Payment could not be started. Please try again.',
} as const

export async function initiateWalletDeposit(
  _prev: WalletDepositState,
  formData: FormData,
): Promise<WalletDepositState> {
  const parsed = walletDepositSchema.safeParse({ amount: formData.get('amount') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to fund your wallet.' }

  const result = await startDeposit(createAdminClient(), {
    playerId: user.id,
    email: user.email ?? null,
    amount: parsed.data.amount,
  })
  if (!result.ok) return { error: DEPOSIT_ERRORS[result.reason] }

  redirect(result.authorizationUrl)
}

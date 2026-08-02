'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildWalletDepositReference } from '@/lib/paystack/server'
import { computePaystackFee } from '@/lib/paystack/fees'
import { walletDepositSchema } from './schema'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type WalletDepositState = { error?: string } | undefined

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

  const amount = parsed.data.amount
  const fee = computePaystackFee(amount)
  const reference = buildWalletDepositReference(user.id)

  const admin = createAdminClient()
  const { error: insertErr } = await admin.from('wallet_deposits').insert({
    player_id: user.id,
    amount,
    fee,
    paystack_reference: reference,
    status: 'pending',
  })
  if (insertErr) return { error: 'Could not start your top-up. Please try again.' }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: (amount + fee) * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { player_id: user.id, amount, fee },
    })
  } catch (err) {
    console.error('[initiateWalletDeposit] Paystack initialize failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}

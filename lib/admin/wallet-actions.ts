'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { creditWallet, getWalletBalance, type WalletTxnType } from '@/lib/wallet/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'

export type ManualCreditResult = { balance: number } | { error: string }

// Core credit action, reusable from any Server Action (e.g. refundRegistration).
// Never writes wallets.balance directly — always goes through creditWallet(),
// which already lazily creates the wallet row on first credit.
export async function manualCreditWallet(
  playerId: string,
  amount: number,
  reason: string,
  type: WalletTxnType = 'admin_credit',
): Promise<ManualCreditResult> {
  await requireAdmin()
  if (!playerId) return { error: 'Missing player.' }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { error: 'Enter a whole naira amount greater than 0.' }
  }
  const trimmedReason = reason.trim()
  if (!trimmedReason) return { error: 'Enter a reason for this credit.' }

  const admin = createAdminClient()
  await creditWallet(admin, playerId, amount, type, null, trimmedReason)
  const balance = await getWalletBalance(admin, playerId)

  await notifyInApp({
    playerId,
    type: 'wallet_credited',
    title: 'Wallet credited',
    body: `${formatNaira(amount)} was added to your wallet: ${trimmedReason}`,
    link: '/dashboard#wallet',
  })

  revalidatePath('/admin/wallet')
  revalidatePath('/dashboard')
  return { balance }
}

export type ManualCreditFormState = { error?: string; success?: boolean; balance?: number } | undefined

export async function manualCreditWalletFormAction(
  _prev: ManualCreditFormState,
  formData: FormData,
): Promise<ManualCreditFormState> {
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const reason = String(formData.get('reason') ?? '')
  const result = await manualCreditWallet(playerId, amount, reason)
  if ('error' in result) return { error: result.error }
  return { success: true, balance: result.balance }
}

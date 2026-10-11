'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { kycSchema } from './schema'
import { resolvePayout, savePayoutAccount, clearPayoutAccount } from './payout-service'
import { RESTRICTION_MESSAGE } from '@/lib/settings/restriction'

const GENERIC_ERROR = 'Could not submit your verification. Please try again.'

const PAYOUT_ERRORS = {
  pending_deletion: RESTRICTION_MESSAGE,
  already_verified: 'You are already verified.',
  account_unresolvable: 'Could not verify this account number. Check the details and try again.',
  unknown_bank: 'Unrecognized bank. Please select your bank again.',
  payout_unavailable: GENERIC_ERROR,
  validation: GENERIC_ERROR,
} as const

export async function resolveAccountName(
  bankCode: string,
  accountNumber: string,
): Promise<{ accountName?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
    return { error: 'Enter a valid account number.' }
  }
  const result = await resolvePayout({ bankCode, accountNumber })
  if (result.ok) return { accountName: result.accountName }
  return { error: 'Could not verify this account number. Check the details and try again.' }
}

export type KycState = { error?: string; success?: boolean } | undefined

// BVN identification (Paystack customer creation + submitBvnIdentification)
// is disabled for now — most players are minors without a BVN, and
// Paystack's identification API has no NIN alternative. Verification is
// synchronous and payout-account-only: a resolvable bank account is the
// only check, since withdrawal payouts are manual (admin pays and marks
// paid) and already involve a human cross-checking these same details.
export async function submitKyc(_prev: KycState, formData: FormData): Promise<KycState> {
  const parsed = kycSchema.safeParse({
    bankCode: formData.get('bankCode'),
    accountNumber: formData.get('accountNumber'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to add your payout details.' }

  // account_name is never trusted from the client: the service resolves it server-side.
  const result = await savePayoutAccount(createAdminClient(), {
    playerId: user.id,
    bankCode: parsed.data.bankCode,
    accountNumber: parsed.data.accountNumber,
  })
  if (!result.ok) return { error: PAYOUT_ERRORS[result.reason] }

  revalidatePath('/dashboard')
  return { success: true }
}

// Admin-only lever: no dedicated UI yet. Lets support unstick a player whose
// verified payout account needs to change (e.g. closed bank account) by
// resetting them back to 'unverified' so they can re-run submitKyc. Deleting
// the row is the reset — 'no row' already means 'unverified' everywhere this
// table is read (see submitKyc and requestWithdrawal, both maybeSingle()).
export async function resetKycForPlayer(playerId: string): Promise<{ error?: string; success?: boolean }> {
  await requireAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('player_kyc').delete().eq('player_id', playerId)
  if (error) return { error: 'Could not reset KYC status.' }
  await admin.from('profiles').update({ kyc_verified: false }).eq('id', playerId)
  revalidatePath('/dashboard')
  return { success: true }
}

// Player-initiated equivalent of resetKycForPlayer — lets a player clear
// their own payout account (e.g. switching banks) and go back through
// submitKyc to re-add one. withdrawal_requests already snapshots its own
// bank_name/account_number/account_name at request time (see migration
// 024), so removing player_kyc here never corrupts an already-submitted
// pending request.
export async function removePayoutAccount(): Promise<{ error?: string; success?: boolean }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const cleared = await clearPayoutAccount(createAdminClient(), user.id)
  if (!cleared.ok) return { error: 'Could not remove your payout account. Please try again.' }

  revalidatePath('/dashboard/wallet/payment-methods')
  return { success: true }
}

'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { kycSchema } from './schema'
import { resolveAccount, createCustomer, submitBvnIdentification, listBanks } from '@/lib/paystack/server'

const GENERIC_ERROR = 'Could not submit your verification. Please try again.'

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
  try {
    const { accountName } = await resolveAccount(accountNumber, bankCode)
    return { accountName }
  } catch {
    return { error: 'Could not verify this account number. Check the details and try again.' }
  }
}

export type KycState = { error?: string; success?: boolean } | undefined

export async function submitKyc(_prev: KycState, formData: FormData): Promise<KycState> {
  const parsed = kycSchema.safeParse({
    bankCode: formData.get('bankCode'),
    accountNumber: formData.get('accountNumber'),
    bvn: formData.get('bvn'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) return { error: 'Please log in to verify your identity.' }

  // A brand-new player has no player_kyc row yet — maybeSingle() returns null,
  // which is the same as 'unverified' for gating purposes.
  const { data: kyc } = await supabase
    .from('player_kyc')
    .select('kyc_status, paystack_customer_code')
    .eq('player_id', user.id)
    .maybeSingle()
  if (kyc?.kyc_status === 'verified') return { error: 'You are already verified.' }
  if (kyc?.kyc_status === 'pending') return { error: 'Verification is already in progress.' }

  // account_name is never trusted from the client — resolved server-side here,
  // same as the amount-from-server rule used elsewhere in this codebase.
  let accountName: string
  try {
    ;({ accountName } = await resolveAccount(parsed.data.accountNumber, parsed.data.bankCode))
  } catch {
    return { error: 'Could not verify this account number. Check the details and try again.' }
  }

  let bankName: string
  try {
    const banks = await listBanks()
    const match = banks.find((b) => b.code === parsed.data.bankCode)
    if (!match) return { error: 'Unrecognized bank. Please select your bank again.' }
    bankName = match.name
  } catch {
    return { error: GENERIC_ERROR }
  }

  const admin = createAdminClient()
  let customerCode = kyc?.paystack_customer_code ?? null
  if (!customerCode) {
    try {
      customerCode = await createCustomer(user.email, parsed.data.firstName, parsed.data.lastName)
    } catch {
      return { error: 'Could not start identity verification. Please try again.' }
    }
  }

  try {
    // BVN is read from parsed.data here and never appears in the update() call
    // below — it must never be written to any column.
    await submitBvnIdentification(customerCode, {
      bvn: parsed.data.bvn,
      bankCode: parsed.data.bankCode,
      accountNumber: parsed.data.accountNumber,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    })
  } catch {
    return { error: GENERIC_ERROR }
  }

  // No player_kyc row exists yet on a first attempt (player_id is the PK, not
  // auto-created) — upsert so both the first attempt and a retry-after-'failed'
  // go through the same call.
  await admin.from('player_kyc').upsert(
    {
      player_id: user.id,
      kyc_status: 'pending',
      kyc_failure_reason: null,
      paystack_customer_code: customerCode,
      payout_bank_code: parsed.data.bankCode,
      payout_bank_name: bankName,
      payout_account_number: parsed.data.accountNumber,
      payout_account_name: accountName,
    },
    { onConflict: 'player_id' },
  )

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

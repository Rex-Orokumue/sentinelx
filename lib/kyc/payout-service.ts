import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { resolveAccount, listBanks } from '@/lib/paystack/server'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'
import { maskAccountNumber, type PayoutAccountMasked } from './logic'

type Admin = SupabaseClient<Database>

const ACCOUNT_NUMBER = /^\d{10}$/

export type { PayoutAccountMasked }

export type ResolvePayoutResult =
  | { ok: true; accountName: string }
  | { ok: false; reason: 'validation' | 'account_unresolvable' }

export async function resolvePayout(args: { bankCode: string; accountNumber: string }): Promise<ResolvePayoutResult> {
  if (!args.bankCode.trim() || !ACCOUNT_NUMBER.test(args.accountNumber)) return { ok: false, reason: 'validation' }
  try {
    const { accountName } = await resolveAccount(args.accountNumber, args.bankCode)
    return { ok: true, accountName }
  } catch (err) {
    console.error('[payout] resolve failed', { message: err instanceof Error ? err.message : String(err) })
    return { ok: false, reason: 'account_unresolvable' }
  }
}

export type SavePayoutResult =
  | { ok: true; payoutAccount: PayoutAccountMasked }
  | {
      ok: false
      reason: 'pending_deletion' | 'already_verified' | 'account_unresolvable' | 'unknown_bank' | 'payout_unavailable' | 'validation'
    }

// Verification is payout-account-only (BVN is disabled): a resolvable bank account is the check.
// The account name and bank name are resolved here on the server and never trusted from the caller.
export async function savePayoutAccount(
  admin: Admin,
  args: { playerId: string; bankCode: string; accountNumber: string },
): Promise<SavePayoutResult> {
  if (!args.bankCode.trim() || !ACCOUNT_NUMBER.test(args.accountNumber)) return { ok: false, reason: 'validation' }
  if (await assertNotPendingDeletion(admin, args.playerId)) return { ok: false, reason: 'pending_deletion' }

  const { data: existing } = await admin.from('player_kyc').select('kyc_status').eq('player_id', args.playerId).maybeSingle()
  if (existing?.kyc_status === 'verified') return { ok: false, reason: 'already_verified' }

  let accountName: string
  try {
    ;({ accountName } = await resolveAccount(args.accountNumber, args.bankCode))
  } catch (err) {
    console.error('[payout] save: resolveAccount failed', { message: err instanceof Error ? err.message : String(err) })
    return { ok: false, reason: 'account_unresolvable' }
  }

  let bankName: string
  try {
    const match = (await listBanks()).find((b) => b.code === args.bankCode)
    if (!match) return { ok: false, reason: 'unknown_bank' }
    bankName = match.name
  } catch (err) {
    console.error('[payout] save: listBanks failed', { message: err instanceof Error ? err.message : String(err) })
    return { ok: false, reason: 'payout_unavailable' }
  }

  // No player_kyc row exists on a first attempt (player_id is the PK): upsert covers first attempt and retry.
  const { error } = await admin.from('player_kyc').upsert(
    {
      player_id: args.playerId,
      kyc_status: 'verified',
      kyc_failure_reason: null,
      payout_bank_code: args.bankCode,
      payout_bank_name: bankName,
      payout_account_number: args.accountNumber,
      payout_account_name: accountName,
    },
    { onConflict: 'player_id' },
  )
  if (error) {
    console.error('[payout] save: upsert failed', { message: error.message })
    return { ok: false, reason: 'payout_unavailable' }
  }
  await admin.from('profiles').update({ kyc_verified: true }).eq('id', args.playerId)

  return { ok: true, payoutAccount: { bankName, accountName, accountNumberMasked: maskAccountNumber(args.accountNumber) } }
}

// withdrawal_requests snapshot their own bank details, so clearing this never corrupts a pending request.
export async function clearPayoutAccount(admin: Admin, playerId: string): Promise<{ ok: true } | { ok: false }> {
  const { error } = await admin.from('player_kyc').delete().eq('player_id', playerId)
  if (error) {
    console.error('[payout] clear failed', { message: error.message })
    return { ok: false }
  }
  await admin.from('profiles').update({ kyc_verified: false }).eq('id', playerId)
  return { ok: true }
}

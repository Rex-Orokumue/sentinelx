import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { maskAccountNumber, type PayoutAccountMasked } from '@/lib/kyc/logic'
import { notifyStaff } from '@/lib/admin/staff'
import { withdrawalNotification } from '@/lib/admin/notification-copy'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'
import { categoryFor } from './service'

type Admin = SupabaseClient<Database>

export type SubmitWithdrawalResult =
  | { ok: true; id: string; amount: number; requestedAt: string; payoutAccount: PayoutAccountMasked }
  | { ok: false; reason: 'pending_deletion' | 'kyc_required' | 'insufficient_balance' | 'withdrawal_pending' | 'failed' }

// Files a withdrawal request for `playerId`. The bank details come from the stored, verified payout
// account (never from the caller). The request row and the wallet debit happen in ONE database
// transaction (wallet_request_withdrawal), so a request can never exist without its debit.
export async function submitWithdrawal(admin: Admin, args: { playerId: string; amount: number }): Promise<SubmitWithdrawalResult> {
  if (await assertNotPendingDeletion(admin, args.playerId)) return { ok: false, reason: 'pending_deletion' }

  const { data: kyc } = await admin
    .from('player_kyc')
    .select('kyc_status, payout_bank_name, payout_account_number, payout_account_name')
    .eq('player_id', args.playerId)
    .maybeSingle()
  if (kyc?.kyc_status !== 'verified' || !kyc.payout_bank_name || !kyc.payout_account_number || !kyc.payout_account_name) {
    return { ok: false, reason: 'kyc_required' }
  }

  const { data, error } = await admin.rpc('wallet_request_withdrawal', {
    p_player: args.playerId,
    p_amount: args.amount,
    p_bank_name: kyc.payout_bank_name,
    p_account_number: kyc.payout_account_number,
    p_account_name: kyc.payout_account_name,
    p_category: categoryFor('withdrawal_request'),
  })
  if (error || !data) {
    console.error('[submitWithdrawal] wallet_request_withdrawal failed', { message: error?.message })
    return { ok: false, reason: 'failed' }
  }
  const outcome = data as { status: string; id?: string }
  if (outcome.status === 'pending_exists') return { ok: false, reason: 'withdrawal_pending' }
  if (outcome.status === 'insufficient') return { ok: false, reason: 'insufficient_balance' }
  if (outcome.status !== 'ok' || !outcome.id) return { ok: false, reason: 'failed' }

  const { data: row } = await admin.from('withdrawal_requests').select('requested_at').eq('id', outcome.id).maybeSingle()
  const requestedAt = row?.requested_at ?? new Date().toISOString()

  const { data: requester } = await admin.from('profiles').select('display_name, username').eq('id', args.playerId).maybeSingle()
  const notification = withdrawalNotification({
    type: 'withdrawal_pending',
    username: requester?.display_name ?? requester?.username ?? 'A player',
    amount: args.amount,
    createdAt: requestedAt,
  })
  void notifyStaff(admin, 'withdrawal_pending', { title: notification.title, body: notification.body, link: notification.link })

  return {
    ok: true,
    id: outcome.id,
    amount: args.amount,
    requestedAt,
    payoutAccount: {
      bankName: kyc.payout_bank_name,
      accountName: kyc.payout_account_name,
      accountNumberMasked: maskAccountNumber(kyc.payout_account_number),
    },
  }
}

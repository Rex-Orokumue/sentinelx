'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'

export type ReferralResolveState = { error?: string; success?: boolean } | undefined

// Manual flow, matching prize withdrawals' current state — no Paystack
// call. See lib/withdrawals/admin-actions.ts for the commented-out
// automated Transfer version; when Paystack Transfer is re-enabled there,
// this flow should be upgraded the same way at the same time so the two
// payout types don't drift apart.
export async function resolveReferralWithdrawal(
  _prev: ReferralResolveState,
  formData: FormData,
): Promise<ReferralResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const supabase = createClient()
  const { data: wr } = await supabase
    .from('referral_withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await supabase
    .from('referral_withdrawal_requests')
    .update({
      status: action === 'paid' ? 'paid' : 'rejected',
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  await notifyInApp({
    playerId: wr.player_id,
    type: action === 'paid' ? 'referral_withdrawal_paid' : 'referral_withdrawal_rejected',
    title: action === 'paid' ? 'Referral withdrawal paid' : 'Referral withdrawal rejected',
    body:
      action === 'paid'
        ? `Your referral withdrawal of ${formatNaira(wr.amount)} has been paid.`
        : note
          ? `Your referral withdrawal was rejected: ${note}`
          : 'Your referral withdrawal was rejected.',
    link: '/dashboard',
  })

  revalidatePath('/admin/referrals')
  revalidatePath('/dashboard')
  return { success: true }
}

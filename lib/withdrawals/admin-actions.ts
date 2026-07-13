'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
// Automatic payout via Paystack Transfer is reverted to manual for now — see
// the commented block below in the 'paid' branch for how to re-enable it.
// import { initiateTransfer, buildTransferReference } from '@/lib/paystack/server'

export type WithdrawalResolveState = { error?: string; success?: boolean } | undefined

export async function resolveWithdrawal(
  _prev: WithdrawalResolveState,
  formData: FormData,
): Promise<WithdrawalResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const supabase = createClient()
  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }

  if (action === 'rejected') {
    if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }
    const { error } = await supabase
      .from('withdrawal_requests')
      .update({ status: 'rejected', admin_note: note || null, resolved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { error: 'Could not resolve the request. Please try again.' }
    revalidatePath('/admin/withdrawals')
    revalidatePath('/dashboard')
    return { success: true }
  }

  // action === 'paid'
  if (wr.status !== 'pending' && wr.status !== 'failed') {
    return { error: 'This request is already being processed or has been resolved.' }
  }

  // --- Automatic payout (Paystack Transfer API) — disabled, kept for reversion ---
  // Uncomment this block and delete the manual update below to restore the
  // automatic flow: admin clicks Pay -> real transfer is initiated -> status
  // moves to 'processing' until the Paystack webhook confirms 'paid'/'failed'.
  //
  // const { data: kyc } = await supabase
  //   .from('player_kyc')
  //   .select('paystack_recipient_code')
  //   .eq('player_id', wr.player_id)
  //   .maybeSingle()
  // if (!kyc?.paystack_recipient_code) {
  //   return { error: 'This player has no verified payout account on file.' }
  // }
  //
  // const reference = buildTransferReference(id)
  // let transferCode: string
  // try {
  //   ;({ transferCode } = await initiateTransfer({
  //     amountKobo: wr.amount * 100,
  //     recipientCode: kyc.paystack_recipient_code,
  //     reference,
  //   }))
  // } catch {
  //   return { error: 'Could not initiate the transfer. Please try again.' }
  // }
  //
  // const { error } = await supabase
  //   .from('withdrawal_requests')
  //   .update({
  //     status: 'processing',
  //     admin_note: note || null,
  //     paystack_transfer_code: transferCode,
  //     paystack_transfer_reference: reference,
  //   })
  //   .eq('id', id)
  // if (error) return { error: 'Transfer started but could not update the request record.' }
  // --- end automatic payout block ---

  // Manual flow: admin pays the player directly (outside this app) and marks
  // the request paid here — no Paystack call is made.
  const { error } = await supabase
    .from('withdrawal_requests')
    .update({ status: 'paid', admin_note: note || null, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Could not mark this request paid. Please try again.' }

  revalidatePath('/admin/withdrawals')
  revalidatePath('/dashboard')
  return { success: true }
}

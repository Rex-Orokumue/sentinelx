'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'
import { creditWallet } from './service'

export type WalletWithdrawalResolveState = { error?: string; success?: boolean } | undefined

export async function resolveWalletWithdrawal(
  _prev: WalletWithdrawalResolveState,
  formData: FormData,
): Promise<WalletWithdrawalResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const admin = createAdminClient()
  const { data: wr } = await admin
    .from('withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await admin
    .from('withdrawal_requests')
    .update({
      status: action === 'paid' ? 'paid' : 'rejected',
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  if (action === 'rejected') {
    // The debited amount was reserved at request time — give it back.
    await creditWallet(admin, wr.player_id, wr.amount, 'withdrawal_reversal', id, note)
  }

  await notifyInApp({
    playerId: wr.player_id,
    type: action === 'paid' ? 'withdrawal_paid' : 'withdrawal_rejected',
    title: action === 'paid' ? 'Withdrawal paid' : 'Withdrawal rejected',
    body:
      action === 'paid'
        ? `Your withdrawal of ${formatNaira(wr.amount)} has been paid.`
        : note
          ? `Your withdrawal request was rejected: ${note}`
          : 'Your withdrawal request was rejected.',
    link: '/dashboard#wallet',
  })

  revalidatePath('/admin/wallet')
  revalidatePath('/dashboard')
  return { success: true }
}

export type AdminCreditState = { error?: string; success?: boolean } | undefined

export async function adminCreditWallet(
  _prev: AdminCreditState,
  formData: FormData,
): Promise<AdminCreditState> {
  await requireAdmin()
  const username = String(formData.get('username') ?? '').trim()
  const amount = Number(formData.get('amount'))
  const note = String(formData.get('note') ?? '').trim()
  if (!username) return { error: 'Enter a username.' }
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'Enter a whole naira amount greater than 0.' }
  if (!note) return { error: 'Enter a note explaining this credit.' }

  const supabase = createClient()
  const { data: player } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (!player) return { error: `No player found with username "${username}".` }

  const admin = createAdminClient()
  await creditWallet(admin, player.id, amount, 'admin_credit', null, note)
  await notifyInApp({
    playerId: player.id,
    type: 'wallet_credited',
    title: 'Wallet credited',
    body: `${formatNaira(amount)} was added to your wallet: ${note}`,
    link: '/dashboard#wallet',
  })

  revalidatePath('/admin/wallet')
  revalidatePath('/dashboard')
  return { success: true }
}

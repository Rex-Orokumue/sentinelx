'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'

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
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await supabase
    .from('withdrawal_requests')
    .update({ status: action, admin_note: note || null, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  revalidatePath('/admin/withdrawals')
  revalidatePath('/dashboard')
  return { success: true }
}

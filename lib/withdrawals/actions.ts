'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withdrawalSchema } from './schema'

export type WithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestWithdrawal(
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  const parsed = withdrawalSchema.safeParse({
    amount: formData.get('amount'),
    bankName: formData.get('bankName') ?? '',
    accountName: formData.get('accountName') ?? '',
    accountNumber: formData.get('accountNumber') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to request a withdrawal.' }

  const { error } = await supabase.from('withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: parsed.data.bankName,
    account_number: parsed.data.accountNumber,
    account_name: parsed.data.accountName,
    status: 'pending',
  })

  if (error) {
    // Partial unique index (one pending per player) surfaces as 23505.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

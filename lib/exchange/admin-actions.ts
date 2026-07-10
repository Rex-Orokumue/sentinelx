'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'

export type ActionState = { error?: string; success?: boolean } | undefined

async function setStatus(id: string, status: 'active' | 'removed'): Promise<ActionState> {
  await requireStaff()
  if (!id) return { error: 'Missing listing.' }
  const supabase = createClient()
  const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id)
  if (error) return { error: 'Could not update the listing.' }
  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  return { success: true }
}

export async function approveListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'active')
}
export async function removeListingAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'removed')
}

'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { buyRequestSchema } from './schema'

export type ActionState = { error?: string; success?: boolean } | undefined

export async function createBuyRequest(input: {
  title: string
  category: string
  gameId?: string
  budget: number
  description?: string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to submit a request.' }

  const parsed = buyRequestSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const { data: request, error } = await supabase
    .from('buy_requests')
    .insert({
      buyer_id: user.id,
      title: d.title,
      category: d.category,
      game_id: d.gameId || null,
      budget: d.budget,
      description: d.description || null,
      status: 'open',
    })
    .select('id')
    .single()
  if (error || !request) return { error: 'Could not submit your request. Please try again.' }

  revalidatePath('/dashboard')
  return { id: request.id }
}

export async function cancelBuyRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing request.' }
  const supabase = createClient()
  // RLS + the status trigger permit a buyer to cancel their own still-open request.
  const { error } = await supabase.from('buy_requests').update({ status: 'closed' }).eq('id', id)
  if (error) return { error: 'Could not cancel the request.' }
  revalidatePath('/dashboard')
  return { success: true }
}

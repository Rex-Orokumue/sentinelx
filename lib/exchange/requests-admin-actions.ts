'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { notifyInApp, type NotificationType } from '@/lib/notifications/inbox'
import { canAdminSetStatus, type BuyRequestStatus } from './requests-guards'

export type ActionState = { error?: string; success?: boolean } | undefined

const NOTIFICATION_FOR: Partial<Record<BuyRequestStatus, NotificationType>> = {
  in_progress: 'buy_request_in_progress',
  fulfilled: 'buy_request_fulfilled',
  closed: 'buy_request_closed',
}

const TITLE_FOR: Partial<Record<BuyRequestStatus, string>> = {
  in_progress: "We're on it",
  fulfilled: 'Request fulfilled',
  closed: 'Request closed',
}

async function setStatus(id: string, next: BuyRequestStatus, note: string | null): Promise<ActionState> {
  await requireAdmin()
  if (!id) return { error: 'Missing request.' }

  const supabase = createClient()
  const { data: request } = await supabase
    .from('buy_requests')
    .select('buyer_id, title, status')
    .eq('id', id)
    .maybeSingle()
  if (!request) return { error: 'Request not found.' }

  if (!canAdminSetStatus(request.status as BuyRequestStatus, next)) {
    return { error: `Can't move a ${request.status} request to ${next}.` }
  }

  const update: { status: BuyRequestStatus; admin_note?: string } = { status: next }
  if (note) update.admin_note = note

  const { error } = await supabase.from('buy_requests').update(update).eq('id', id)
  if (error) return { error: 'Could not update the request.' }

  const type = NOTIFICATION_FOR[next]
  if (type) {
    await notifyInApp({
      playerId: request.buyer_id,
      type,
      title: TITLE_FOR[next] ?? 'Request updated',
      body: note
        ? `Your request "${request.title}": ${note}`
        : `Your request "${request.title}" is now ${next.replace('_', ' ')}.`,
      link: '/dashboard',
    })
  }

  revalidatePath('/admin/exchange/requests')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function markBuyRequestInProgress(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'in_progress', null)
}

export async function markBuyRequestFulfilled(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'fulfilled', null)
}

export async function closeBuyRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const note = String(formData.get('note') ?? '').trim()
  return setStatus(String(formData.get('id') ?? ''), 'closed', note || null)
}

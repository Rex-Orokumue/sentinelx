'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'

export type ActionState = { error?: string; success?: boolean } | undefined

async function setStatus(id: string, status: 'active' | 'removed'): Promise<ActionState> {
  await requireStaff()
  if (!id) return { error: 'Missing listing.' }
  const supabase = createClient()
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('seller_id, title')
    .eq('id', id)
    .maybeSingle()
  const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id)
  if (error) return { error: 'Could not update the listing.' }

  if (listing) {
    await notifyInApp({
      playerId: listing.seller_id,
      type: status === 'active' ? 'listing_approved' : 'listing_removed',
      title: status === 'active' ? 'Listing approved' : 'Listing removed',
      body:
        status === 'active'
          ? `Your listing "${listing.title}" is now live on the Exchange.`
          : `Your listing "${listing.title}" was removed by an admin.`,
      link: '/exchange',
    })
  }

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

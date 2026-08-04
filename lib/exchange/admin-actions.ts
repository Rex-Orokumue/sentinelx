'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { notify } from '@/lib/notifications/notify'
import { hasAnyOrder, hasInProgressOrder } from './admin-guards'
import { transitionForEvent } from './escrow'

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

export async function deleteListingAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing listing.' }

  const supabase = createClient()
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('seller_id, title')
    .eq('id', id)
    .maybeSingle()
  if (!listing) return { error: 'Listing not found.' }

  const { data: orders } = await supabase
    .from('marketplace_orders')
    .select('status')
    .eq('listing_id', id)
  if (hasAnyOrder((orders ?? []).map((o) => o.status))) {
    return { error: "Can't delete — this listing has order history. Use Remove instead." }
  }

  const { error } = await supabase.from('marketplace_listings').delete().eq('id', id)
  if (error) return { error: 'Could not delete the listing.' }

  await notifyInApp({
    playerId: listing.seller_id,
    type: 'listing_deleted',
    title: 'Listing deleted',
    body: `Your listing "${listing.title}" was deleted by an admin.`,
    link: '/exchange',
  })

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function cancelOrderAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing order.' }

  const admin = createAdminClient()
  const { data: order } = await admin
    .from('marketplace_orders')
    .select('id, listing_id, buyer_id, status, listing_title, zolarux_order_ref')
    .eq('id', id)
    .maybeSingle()
  if (!order) return { error: 'Order not found.' }
  if (order.status === 'completed' || order.status === 'refunded') {
    return { error: `Order is already ${order.status}.` }
  }

  const transition = transitionForEvent('order_refunded')
  if (!transition) return { error: 'Could not resolve the order.' }

  const { error: orderErr } = await admin
    .from('marketplace_orders')
    .update({ status: transition.orderStatus })
    .eq('id', order.id)
  if (orderErr) return { error: 'Could not update the order.' }

  const { error: listingErr } = await admin
    .from('marketplace_listings')
    .update({ status: transition.listingStatus })
    .eq('id', order.listing_id)
  if (listingErr) return { error: 'Could not update the listing.' }

  await notify({
    playerId: order.buyer_id,
    type: 'escrow_refunded',
    title: order.listing_title,
    dedupeKey: `escrow:${order.zolarux_order_ref}:order_refunded`,
  })

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function markListingSoldAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing listing.' }

  const supabase = createClient()
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('seller_id, title, status')
    .eq('id', id)
    .maybeSingle()
  if (!listing) return { error: 'Listing not found.' }
  if (listing.status === 'sold' || listing.status === 'removed') {
    return { error: `Listing is already ${listing.status}.` }
  }

  const { data: orders } = await supabase
    .from('marketplace_orders')
    .select('status')
    .eq('listing_id', id)
  if (hasInProgressOrder((orders ?? []).map((o) => o.status))) {
    return { error: 'This listing has an order in progress — resolve it before marking sold.' }
  }

  const { error } = await supabase.from('marketplace_listings').update({ status: 'sold' }).eq('id', id)
  if (error) return { error: 'Could not update the listing.' }

  await notifyInApp({
    playerId: listing.seller_id,
    type: 'listing_sold',
    title: 'Listing marked as sold',
    body: `Your listing "${listing.title}" was marked as sold by an admin.`,
    link: '/exchange',
  })

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  revalidatePath('/dashboard')
  return { success: true }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bearerOk, transitionForEvent } from '@/lib/exchange/escrow'
import { notify } from '@/lib/notifications/notify'

export const runtime = 'nodejs'

// Machine-to-machine from Zolarux. Reflects escrow state onto the local order + listing.
export async function POST(req: NextRequest) {
  if (!bearerOk(req.headers.get('authorization'), process.env.SENTINELX_API_SECRET)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let body: { event?: string; order_ref?: string }
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const transition = body.event ? transitionForEvent(body.event) : null
  if (!transition || !body.order_ref) {
    return new NextResponse('Unknown event', { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin
    .from('marketplace_orders')
    .select('id, listing_id, buyer_id, seller_id, listing_title, status')
    .eq('zolarux_order_ref', body.order_ref)
    .maybeSingle()

  if (!order) return new NextResponse('Order not found', { status: 404 })

  // Idempotent: Zolarux may retry a delivered webhook.
  if (order.status === transition.orderStatus) return new NextResponse('ok', { status: 200 })

  await admin
    .from('marketplace_orders')
    .update({ status: transition.orderStatus })
    .eq('id', order.id)

  await admin
    .from('marketplace_listings')
    .update({ status: transition.listingStatus })
    .eq('id', order.listing_id)

  // Best-effort WhatsApp notification (never throws).
  if (body.event === 'payment_held') {
    await notify({
      playerId: order.seller_id,
      type: 'escrow_sale',
      title: order.listing_title,
      dedupeKey: `escrow:${body.order_ref}:payment_held`,
    })
  } else if (body.event === 'delivery_confirmed') {
    await notify({
      playerId: order.buyer_id,
      type: 'escrow_completed',
      title: order.listing_title,
      dedupeKey: `escrow:${body.order_ref}:delivery_confirmed`,
    })
  } else if (body.event === 'order_refunded') {
    await notify({
      playerId: order.buyer_id,
      type: 'escrow_refunded',
      title: order.listing_title,
      dedupeKey: `escrow:${body.order_ref}:order_refunded`,
    })
  }

  return new NextResponse('ok', { status: 200 })
}

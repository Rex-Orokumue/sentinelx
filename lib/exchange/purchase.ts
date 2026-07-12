'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildInitiatePayload, validatePurchase } from './escrow'

const GENERIC_ERROR = 'Secure checkout is temporarily unavailable. Please try again shortly.'

export async function initiateEscrowPurchase(
  listingId: string,
): Promise<{ paymentLink?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Load the listing (RLS lets anyone read an 'active' listing).
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('id, title, price, status, seller_id')
    .eq('id', listingId)
    .maybeSingle()

  if (!listing) return { error: 'This listing could not be found.' }

  const guard = validatePurchase({
    userId: user?.id ?? null,
    listingStatus: listing.status,
    sellerId: listing.seller_id,
  })
  if (guard) return { error: guard }

  const secret = process.env.SENTINELX_API_SECRET
  const url = process.env.ZOLARUX_INITIATE_URL
  if (!secret || !url) return { error: GENERIC_ERROR }

  const payload = buildInitiatePayload({
    listingId: listing.id,
    listingTitle: listing.title,
    buyerId: user!.id,
    sellerId: listing.seller_id,
    priceNgn: listing.price,
  })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    // Surface the real cause in Vercel logs — the user-facing message is
    // intentionally generic (never expose escrow-provider internals to buyers).
    console.error('[initiateEscrowPurchase] Zolarux request failed', {
      listingId: listing.id,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: GENERIC_ERROR }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[initiateEscrowPurchase] Zolarux returned a non-OK status', {
      listingId: listing.id,
      status: res.status,
      body: body.slice(0, 500),
    })
    return { error: GENERIC_ERROR }
  }

  let json: { order_id?: string; order_ref?: string; payment_link?: string }
  try {
    json = await res.json()
  } catch (err) {
    console.error('[initiateEscrowPurchase] Zolarux response was not valid JSON', {
      listingId: listing.id,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: GENERIC_ERROR }
  }
  if (!json.order_id || !json.order_ref || !json.payment_link) {
    console.error('[initiateEscrowPurchase] Zolarux response missing required fields', {
      listingId: listing.id,
      json,
    })
    return { error: GENERIC_ERROR }
  }

  // Reuse an abandoned 'initiated' order for this listing+buyer instead of
  // piling up a new row on every retry — payment_held/completed/refunded
  // orders are never revisited here since validatePurchase already blocks
  // re-purchasing a listing that isn't 'active' anymore.
  const { data: existingOrder } = await supabase
    .from('marketplace_orders')
    .select('id')
    .eq('listing_id', listing.id)
    .eq('buyer_id', user!.id)
    .eq('status', 'initiated')
    .maybeSingle()

  const orderFields = {
    zolarux_order_id: json.order_id,
    zolarux_order_ref: json.order_ref,
    amount: listing.price,
    listing_title: listing.title,
    status: 'initiated',
  }

  // Writes go via the service-role client (no client INSERT/UPDATE policy).
  const admin = createAdminClient()
  if (existingOrder) {
    const { error: updateErr } = await admin
      .from('marketplace_orders')
      .update(orderFields)
      .eq('id', existingOrder.id)
    if (updateErr) return { error: GENERIC_ERROR }
  } else {
    const { error: insertErr } = await admin.from('marketplace_orders').insert({
      listing_id: listing.id,
      buyer_id: user!.id,
      seller_id: listing.seller_id,
      ...orderFields,
    })
    if (insertErr) return { error: GENERIC_ERROR }
  }

  return { paymentLink: json.payment_link }
}

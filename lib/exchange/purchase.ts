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
  } catch {
    return { error: GENERIC_ERROR }
  }
  if (!res.ok) return { error: GENERIC_ERROR }

  let json: { order_id?: string; order_ref?: string; payment_link?: string }
  try {
    json = await res.json()
  } catch {
    return { error: GENERIC_ERROR }
  }
  if (!json.order_id || !json.order_ref || !json.payment_link) return { error: GENERIC_ERROR }

  // Record the local mirror row via the service-role client (no client INSERT policy).
  const admin = createAdminClient()
  const { error: insertErr } = await admin.from('marketplace_orders').insert({
    listing_id: listing.id,
    buyer_id: user!.id,
    seller_id: listing.seller_id,
    zolarux_order_id: json.order_id,
    zolarux_order_ref: json.order_ref,
    amount: listing.price,
    listing_title: listing.title,
    status: 'initiated',
  })
  if (insertErr) return { error: GENERIC_ERROR }

  return { paymentLink: json.payment_link }
}

import Link from 'next/link'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { ExchangeQueueRow, type PendingListing } from '@/components/admin/ExchangeQueueRow'
import { AdminOrderRow, type AdminOrderRow as AdminOrderRowType } from '@/components/admin/AdminOrderRow'
import { ExchangeListingRow, type AdminListing } from '@/components/admin/ExchangeListingRow'
import { primaryImageUrl } from '@/lib/exchange/images'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ListingCategory } from '@/lib/exchange/schema'
import { buildSellerWhatsAppUrl } from '@/lib/exchange/admin-whatsapp'
import { hasAnyOrder, hasInProgressOrder } from '@/lib/exchange/admin-guards'

export const metadata: Metadata = { title: 'Exchange · Admin · SentinelX' }

const ORDERS_PAGE_SIZE = 10
const LISTINGS_PAGE_SIZE = 100

type NameRef = { username: string | null } | { username: string | null }[] | null
function firstUsername(p: NameRef): string | null {
  return Array.isArray(p) ? p[0]?.username ?? null : p?.username ?? null
}

type Row = {
  id: string
  title: string
  price: number
  category: ListingCategory
  seller: NameRef
  listing_images: { image_url: string; display_order: number }[] | null
}

export default async function AdminExchangePage({
  searchParams,
}: {
  searchParams: { before?: string; status?: string }
}) {
  await requireStaff()
  const supabase = createClient()
  let ordersQuery = supabase
    .from('marketplace_orders')
    .select(
      'id, listing_title, amount, status, zolarux_order_ref, created_at, ' +
        'buyer:profiles!marketplace_orders_buyer_id_fkey(username), ' +
        'seller:profiles!marketplace_orders_seller_id_fkey(username)',
    )
    .order('created_at', { ascending: false })
    .limit(ORDERS_PAGE_SIZE)
  if (searchParams.before) ordersQuery = ordersQuery.lt('created_at', searchParams.before)

  const VALID_STATUSES = ['pending', 'active', 'sold', 'removed', 'reserved'] as const
  const statusFilter = VALID_STATUSES.includes(searchParams.status as (typeof VALID_STATUSES)[number])
    ? searchParams.status
    : undefined

  let allListingsQuery = supabase
    .from('marketplace_listings')
    .select(
      'id, title, price, category, status, ' +
        'seller:profiles!marketplace_listings_seller_id_fkey(username, whatsapp_number, country), ' +
        'listing_images(image_url, display_order)',
    )
    .order('created_at', { ascending: false })
    .limit(LISTINGS_PAGE_SIZE)
  if (statusFilter) allListingsQuery = allListingsQuery.eq('status', statusFilter)

  const [{ data }, { data: orderData }, { data: allListingsData }] = await Promise.all([
    supabase
      .from('marketplace_listings')
      .select('id, title, price, category, seller:profiles!marketplace_listings_seller_id_fkey(username), listing_images(image_url, display_order)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    ordersQuery,
    allListingsQuery,
  ])

  type ListingSeller = { username: string | null; whatsapp_number: string | null; country: string | null }
  type AllListingRow = {
    id: string
    title: string
    price: number
    category: ListingCategory
    status: AdminListing['status']
    seller: ListingSeller | ListingSeller[] | null
    listing_images: { image_url: string; display_order: number }[] | null
  }
  const allListingRows = (allListingsData ?? []) as unknown as AllListingRow[]
  const listingIds = allListingRows.map((r) => r.id)

  const { data: orderStatusData } =
    listingIds.length === 0
      ? { data: [] as { listing_id: string; status: string }[] }
      : await supabase.from('marketplace_orders').select('listing_id, status').in('listing_id', listingIds)

  const orderStatusesByListing = new Map<string, string[]>()
  for (const o of orderStatusData ?? []) {
    const list = orderStatusesByListing.get(o.listing_id) ?? []
    list.push(o.status)
    orderStatusesByListing.set(o.listing_id, list)
  }

  const allListings: AdminListing[] = allListingRows.map((r) => {
    const seller = Array.isArray(r.seller) ? r.seller[0] ?? null : r.seller
    const orderStatuses = orderStatusesByListing.get(r.id) ?? []
    return {
      id: r.id,
      title: r.title,
      price: r.price,
      category: r.category,
      status: r.status,
      sellerName: seller?.username ?? 'seller',
      primaryImage: primaryImageUrl(r.listing_images ?? []),
      whatsappUrl: buildSellerWhatsAppUrl({
        sellerWhatsapp: seller?.whatsapp_number ?? null,
        sellerCountry: seller?.country ?? null,
        sellerName: seller?.username ?? 'seller',
        listingTitle: r.title,
        price: r.price,
      }),
      canDelete: !hasAnyOrder(orderStatuses),
      canMarkSold: !hasInProgressOrder(orderStatuses),
    }
  })

  const rows = (data ?? []) as unknown as Row[]
  const pending: PendingListing[] = rows.map((r) => {
    const seller = Array.isArray(r.seller) ? r.seller[0] ?? null : r.seller
    return {
      id: r.id,
      title: r.title,
      price: r.price,
      category: r.category,
      sellerName: seller?.username ?? 'seller',
      primaryImage: primaryImageUrl(r.listing_images ?? []),
      imageCount: (r.listing_images ?? []).length,
    }
  })

  const orders: AdminOrderRowType[] = ((orderData as unknown[] | null) ?? []).map((raw) => {
    const o = raw as {
      id: string
      listing_title: string
      amount: number
      status: string
      zolarux_order_ref: string
      created_at: string
      buyer: NameRef
      seller: NameRef
    }
    return {
      id: o.id,
      listingTitle: o.listing_title,
      amount: o.amount,
      status: o.status,
      zolaruxOrderRef: o.zolarux_order_ref,
      buyerUsername: firstUsername(o.buyer),
      sellerUsername: firstUsername(o.seller),
      createdAt: o.created_at,
    }
  })

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-white">Exchange — pending review</h1>
      {pending.length === 0 ? (
        <EmptyState icon="🛒" title="Nothing to review" body="New listings awaiting approval will show up here." />
      ) : (
        <div className="space-y-2">
          {pending.map((l) => (
            <ExchangeQueueRow key={l.id} listing={l} />
          ))}
        </div>
      )}

      <h2 className="mb-4 mt-10 text-base font-bold text-white">Recent orders</h2>
      {orders.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No orders yet.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {orders.map((o) => (
              <AdminOrderRow key={o.id} order={o} />
            ))}
          </div>
          {orders.length === ORDERS_PAGE_SIZE && (
            <div className="mt-4 text-center">
              <Link
                href={`/admin/exchange?before=${encodeURIComponent(orders[orders.length - 1].createdAt)}`}
                className="text-sm text-violet-400 hover:text-violet-300"
              >
                Load more →
              </Link>
            </div>
          )}
        </>
      )}

      <h2 className="mb-4 mt-10 text-base font-bold text-white">All listings</h2>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(['all', ...VALID_STATUSES] as const).map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/admin/exchange' : `/admin/exchange?status=${s}`}
            className={`rounded-full border px-3 py-1 font-bold ${
              (s === 'all' && !statusFilter) || s === statusFilter
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-slate-800 text-slate-400 hover:border-slate-600'
            }`}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>
      {allListings.length === 0 ? (
        <EmptyState icon="🛒" title="No listings" body="No listings match this filter." />
      ) : (
        <div className="space-y-2">
          {allListings.map((l) => (
            <ExchangeListingRow key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  )
}

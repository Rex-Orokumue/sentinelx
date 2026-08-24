import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MyListings, type MyListing } from '@/components/dashboard/MyListings'
import { MyBuyRequests, type MyBuyRequest } from '@/components/dashboard/MyBuyRequests'
import { MyOrders } from '@/components/dashboard/MyOrders'
import { MySales } from '@/components/dashboard/MySales'
import { latestPerListing, type OrderRow } from '@/lib/exchange/orders'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = { title: 'Marketplace · SentinelX Esports', robots: { index: false, follow: false } }

export default async function DashboardMarketplacePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/marketplace')

  const [listingsRes, buyRequestsRes, ordersRes, salesRes] = await Promise.all([
    supabase
      .from('marketplace_listings')
      .select('id, title, price, status')
      .eq('seller_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false }),
    supabase
      .from('buy_requests')
      .select('id, title, budget, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('marketplace_orders')
      .select('id, listing_id, listing_title, amount, status')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const myListings: MyListing[] = (listingsRes.data ?? []).map((l) => ({
    id: l.id, title: l.title, price: l.price, status: l.status,
  }))
  const myBuyRequests: MyBuyRequest[] = (buyRequestsRes.data ?? []).map((r) => ({
    id: r.id, title: r.title, budget: r.budget, status: r.status as MyBuyRequest['status'],
  }))
  const toOrderRow = (r: { id: string; listing_id: string; listing_title: string; amount: number; status: string }): OrderRow => ({
    id: r.id, listingId: r.listing_id, title: r.listing_title, amount: r.amount, status: r.status,
  })
  // Both queries are already newest-first — collapse abandoned retries of the
  // same listing down to just the latest attempt.
  const myOrders: OrderRow[] = latestPerListing((ordersRes.data ?? []).map(toOrderRow))
  const mySales: OrderRow[] = latestPerListing((salesRes.data ?? []).map(toOrderRow))

  return (
    <DashboardShell>
      <h1 className="text-lg font-bold text-white">Marketplace</h1>
      <MyListings listings={myListings} />
      <MyBuyRequests requests={myBuyRequests} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />
    </DashboardShell>
  )
}

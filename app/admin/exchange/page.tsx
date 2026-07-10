import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { ExchangeQueueRow, type PendingListing } from '@/components/admin/ExchangeQueueRow'
import { primaryImageUrl } from '@/lib/exchange/images'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ListingCategory } from '@/lib/exchange/schema'

export const metadata: Metadata = { title: 'Exchange · Admin · SentinelX' }

type NameRef = { username: string | null } | { username: string | null }[] | null
type Row = {
  id: string
  title: string
  price: number
  category: ListingCategory
  seller: NameRef
  listing_images: { image_url: string; display_order: number }[] | null
}

export default async function AdminExchangePage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('marketplace_listings')
    .select('id, title, price, category, seller:profiles!marketplace_listings_seller_id_fkey(username), listing_images(image_url, display_order)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

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
    </div>
  )
}

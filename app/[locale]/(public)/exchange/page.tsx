import { createClient } from '@/lib/supabase/server'
import type { ListingCardData } from '@/components/exchange/ListingCard'
import { ExchangeHero } from '@/components/exchange/ExchangeHero'
import { EscrowStrip } from '@/components/exchange/EscrowStrip'
import { CategoryGrid } from '@/components/exchange/CategoryGrid'
import { FeaturedListings } from '@/components/exchange/FeaturedListings'
import { QuickActionsPanel } from '@/components/exchange/QuickActionsPanel'
import { TrustPanel } from '@/components/exchange/TrustPanel'
import { TrendingNow } from '@/components/exchange/TrendingNow'
import { JoinCtaBand } from '@/components/exchange/JoinCtaBand'
import { primaryImageUrl } from '@/lib/exchange/images'
import { badgeSortWeight } from '@/lib/exchange/badges'
import { fetchCategoryCounts, fetchExchangeStats } from '@/lib/exchange/stats'
import { LISTING_CATEGORIES, type ListingBadge, type ListingCategory } from '@/lib/exchange/schema'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Gaming Exchange — SentinelX Esports',
    description: 'Buy and sell gaming accounts, coins, and gear on Sentinel X — protected by Zolarux escrow.',
    path: '/exchange', // canonical intentionally omits the `category` filter param
    image: DEFAULT_OG_IMAGE,
    locale,
  })
}

type SearchParams = { category?: string }

type SellerRel = { username: string | null; display_name: string | null; kyc_verified: boolean }

type Row = {
  id: string
  title: string
  price: number
  original_price: number | null
  badge: string | null
  subtitle: string | null
  description: string | null
  category: ListingCategory
  created_at: string
  games: { name: string } | { name: string }[] | null
  listing_images: { image_url: string; display_order: number }[] | null
  profiles: SellerRel | SellerRel[] | null
}

const LISTING_SELECT = `
  id, title, price, original_price, badge, subtitle, description, category, created_at,
  games(name),
  listing_images(image_url, display_order),
  profiles!marketplace_listings_seller_id_fkey(username, display_name, kyc_verified)
`

// Supabase types an embedded one-to-one relation as either an object or an
// array depending on how it infers the join; normalise both shapes.
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

function toCardData(r: Row): ListingCardData {
  const seller = one(r.profiles)
  return {
    id: r.id,
    title: r.title,
    price: r.price,
    originalPrice: r.original_price,
    category: r.category,
    badge: r.badge as ListingBadge | null,
    subtitle: r.subtitle,
    description: r.description,
    gameName: one(r.games)?.name ?? null,
    primaryImage: primaryImageUrl(r.listing_images ?? []),
    sellerName: seller?.display_name ?? seller?.username ?? null,
    sellerVerified: seller?.kyc_verified ?? false,
  }
}

export default async function ExchangePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const category = searchParams.category as ListingCategory | undefined
  const activeCategory = category && LISTING_CATEGORIES.includes(category) ? category : undefined

  let listingQuery = supabase
    .from('marketplace_listings')
    .select(LISTING_SELECT)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (activeCategory) listingQuery = listingQuery.eq('category', activeCategory)

  // Independent reads issue together rather than four sequential round-trips.
  const [{ data: user }, listingResult, trendingResult, counts, stats] = await Promise.all([
    supabase.auth.getUser(),
    listingQuery,
    supabase
      .from('marketplace_listings')
      .select(LISTING_SELECT)
      .eq('status', 'active')
      .order('view_count', { ascending: false })
      .limit(4),
    fetchCategoryCounts(supabase),
    fetchExchangeStats(supabase),
  ])

  const signedIn = Boolean(user?.user)

  const listings = ((listingResult.data ?? []) as unknown as Row[])
    .map(toCardData)
    // Badged listings lead — featured first — then newest, which the query
    // already ordered by, and Array.prototype.sort is stable.
    .sort((a, b) => badgeSortWeight(a.badge) - badgeSortWeight(b.badge))

  const trending = ((trendingResult.data ?? []) as unknown as Row[]).map(toCardData)

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-20 pt-6">
      <ExchangeHero />
      <EscrowStrip />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <CategoryGrid counts={counts} />
          <FeaturedListings listings={listings} />
        </div>

        <aside className="space-y-6 lg:col-span-4">
          <QuickActionsPanel signedIn={signedIn} />
          <TrustPanel />
          <TrendingNow listings={trending} />
        </aside>
      </div>

      <JoinCtaBand stats={stats} signedIn={signedIn} />
    </div>
  )
}

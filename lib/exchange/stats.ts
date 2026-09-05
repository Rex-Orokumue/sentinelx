import { formatCompactNumber } from '@/lib/format'
import type { createClient } from '@/lib/supabase/server'
import { LISTING_CATEGORIES, type ListingCategory } from './schema'

type SupabaseServerClient = ReturnType<typeof createClient>

const COMPACT_FLOOR = 1000

// Below 1000 the exact number reads better than an abbreviation, and on a young
// marketplace that is the common case. Above it, the mockup's "50K+" style.
export function formatStatCount(n: number): string {
  return n < COMPACT_FLOOR ? String(n) : `${formatCompactNumber(n)}+`
}

// "Positive feedback" is order completion rate — the only real trust signal the
// schema carries. There is no marketplace rating table; opponent_ratings is
// match-only. With no orders at all we show an em dash rather than a flattering
// but meaningless 100%.
export function formatPositiveFeedback(completed: number, refunded: number): string {
  const total = completed + refunded
  if (total === 0) return '—'
  const pct = (completed / total) * 100
  return `${Number(pct.toFixed(1))}%`
}

export function formatListingCount(n: number): string {
  if (n === 0) return 'No listings yet'
  if (n === 1) return '1 Listing'
  return `${n < COMPACT_FLOOR ? n : `${formatCompactNumber(n)}+`} Listings`
}

export interface ExchangeStats {
  happyGamers: number
  successfulTrades: number
  verifiedSellers: number
  /** Already formatted — see formatPositiveFeedback. */
  positiveFeedback: string
}

// Every figure on the Join band is real. Early numbers will be small; that was
// chosen deliberately over inventing figures on a page about trust.
export async function fetchExchangeStats(supabase: SupabaseServerClient): Promise<ExchangeStats> {
  const [gamers, completed, refunded, sellers] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed'),
    supabase
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'refunded'),
    supabase
      .from('marketplace_listings')
      .select('seller_id, profiles!inner(kyc_verified)')
      .eq('status', 'active')
      .eq('profiles.kyc_verified', true),
  ])

  const completedCount = completed.count ?? 0
  const refundedCount = refunded.count ?? 0

  // Distinct sellers — the join returns one row per active listing, and a seller
  // with three listings must not count three times.
  const distinctSellers = new Set((sellers.data ?? []).map((r) => r.seller_id)).size

  return {
    happyGamers: gamers.count ?? 0,
    successfulTrades: completedCount,
    verifiedSellers: distinctSellers,
    positiveFeedback: formatPositiveFeedback(completedCount, refundedCount),
  }
}

// Seeded with every category so a tile with no listings still renders, showing
// "No listings yet" rather than vanishing from the row.
export async function fetchCategoryCounts(
  supabase: SupabaseServerClient,
): Promise<Record<ListingCategory, number>> {
  const counts = Object.fromEntries(LISTING_CATEGORIES.map((c) => [c, 0])) as Record<
    ListingCategory,
    number
  >

  const { data } = await supabase
    .from('marketplace_listings')
    .select('category')
    .eq('status', 'active')

  for (const row of data ?? []) {
    const c = row.category as ListingCategory
    if (c in counts) counts[c] += 1
  }

  return counts
}

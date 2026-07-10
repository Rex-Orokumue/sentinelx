import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ListingCard, type ListingCardData } from '@/components/exchange/ListingCard'
import { primaryImageUrl } from '@/lib/exchange/images'
import { LISTING_CATEGORIES, CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export const metadata: Metadata = {
  title: 'Gaming Exchange — SentinelX Esports',
  description: 'Buy and sell gaming accounts, coins, and gear on Sentinel X — protected by Zolarux escrow.',
  openGraph: {
    title: 'Gaming Exchange — SentinelX Esports',
    description: 'Buy and sell gaming accounts, coins, and gear — protected by escrow.',
    url: `${SITE_URL}/exchange`,
    siteName: 'SentinelX Esports',
    type: 'website',
  },
}

type SearchParams = { category?: string }

type Row = {
  id: string
  title: string
  price: number
  category: ListingCategory
  games: { name: string } | { name: string }[] | null
  listing_images: { image_url: string; display_order: number }[] | null
}
function gameName(g: Row['games']): string | null {
  const r = Array.isArray(g) ? g[0] ?? null : g
  return r?.name ?? null
}

export default async function ExchangePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient()
  const category = searchParams.category as ListingCategory | undefined
  let q = supabase
    .from('marketplace_listings')
    .select('id, title, price, category, games(name), listing_images(image_url, display_order)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (category && LISTING_CATEGORIES.includes(category)) q = q.eq('category', category)
  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  const listings: ListingCardData[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    price: r.price,
    category: r.category,
    gameName: gameName(r.games),
    primaryImage: primaryImageUrl(r.listing_images ?? []),
  }))

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="flex items-center justify-between gap-3 py-8">
        <div>
          <h1 className="text-2xl font-black text-white">Gaming Exchange</h1>
          <p className="mt-1 text-sm text-slate-400">Accounts, coins, and gear — protected by Zolarux escrow.</p>
        </div>
        <Link href="/exchange/new" className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500">
          Sell an item
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChip label="All" href="/exchange" active={!category} />
        {LISTING_CATEGORIES.map((c) => (
          <FilterChip key={c} label={CATEGORY_LABELS[c]} href={`/exchange?category=${c}`} active={category === c} />
        ))}
      </div>

      {listings.length === 0 ? (
        <EmptyState icon="🛒" title="Nothing listed yet" body="Be the first to list an item on the Gaming Exchange." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? 'border-violet-500 bg-violet-600/20 text-violet-300' : 'border-slate-700 text-slate-400 hover:text-white'}`}
    >
      {label}
    </Link>
  )
}

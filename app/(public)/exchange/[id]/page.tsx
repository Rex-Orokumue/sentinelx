import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ImageGallery } from '@/components/exchange/ImageGallery'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { primaryImageUrl } from '@/lib/exchange/images'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type NameRef = { username: string | null } | { username: string | null }[] | null
type GameRef = { name: string } | { name: string }[] | null
type ListingRow = {
  id: string
  title: string
  description: string | null
  price: number
  category: ListingCategory
  status: string
  seller: NameRef
  games: GameRef
  listing_images: { image_url: string; display_order: number }[] | null
}
function first<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}
const COLS =
  'id, title, description, price, category, status, ' +
  'seller:profiles!marketplace_listings_seller_id_fkey(username), ' +
  'games(name), listing_images(image_url, display_order)'

async function load(id: string): Promise<ListingRow | null> {
  const supabase = createClient()
  const { data } = await supabase.from('marketplace_listings').select(COLS).eq('id', id).maybeSingle()
  return (data as unknown as ListingRow | null) ?? null
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const l = await load(params.id)
  if (!l) return { title: 'Listing not found — SentinelX Esports' }
  const title = `${l.title} — ${formatNaira(l.price)} · Gaming Exchange`
  const image = primaryImageUrl(l.listing_images ?? [])
  return {
    title,
    description: l.description ?? 'On the Sentinel X Gaming Exchange.',
    openGraph: {
      title,
      url: `${SITE_URL}/exchange/${l.id}`,
      siteName: 'SentinelX Esports',
      type: 'website',
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const l = await load(params.id)
  // Only active listings are public (RLS also hides non-active from non-owners).
  if (!l || l.status !== 'active') notFound()

  const images = [...(l.listing_images ?? [])]
    .sort((a, b) => a.display_order - b.display_order)
    .map((i) => i.image_url)
  const sellerName = first(l.seller)?.username ?? null
  const game = first(l.games)?.name ?? null

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <ImageGallery images={images} title={l.title} />

      <div className="mt-5">
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold uppercase text-slate-300">
          {CATEGORY_LABELS[l.category]}
        </span>
        <h1 className="mt-2 text-2xl font-black text-white">{l.title}</h1>
        <p className="mt-1 text-2xl font-black text-violet-400">{formatNaira(l.price)}</p>
        {game && <p className="mt-1 text-sm text-slate-400">{game}</p>}
        {/* Seller: @username only, plain link — no other profile info surfaced. */}
        {sellerName && (
          <p className="mt-2 text-sm text-slate-400">
            Seller:{' '}
            <Link href={`/players/${sellerName}`} className="font-semibold text-violet-400 hover:text-violet-300">
              @{sellerName}
            </Link>
          </p>
        )}
      </div>

      {l.description && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{l.description}</p>}

      <div className="mt-6">
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl bg-slate-800 px-5 py-3 text-sm font-bold text-slate-400"
        >
          🔒 Buy — Protected by Zolarux
        </button>
        <p className="mt-1.5 text-center text-xs text-slate-500">Secure escrow checkout is coming soon.</p>
      </div>
    </div>
  )
}

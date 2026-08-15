import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance } from '@/lib/coins/service'
import { StoreGrid } from '@/components/store/StoreGrid'
import { buildMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Store — Sentinel X',
  description: 'Spend your SX Coins on avatar borders, profile themes, username colours, and mascot skins.',
  path: '/store',
})

export default async function StorePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: items } = await supabase
    .from('store_items')
    .select('id, slug, name, description, category, price_coins, preview_url')
    .eq('active', true)
    .order('category')
    .order('sort_order')

  let ownedItemIds = new Set<string>()
  let equippedItemIds = new Set<string>()
  let balance = 0
  if (user) {
    const admin = createAdminClient()
    const [{ data: owned }, coinBalance] = await Promise.all([
      admin.from('player_store_items').select('item_id, equipped').eq('player_id', user.id),
      getCoinBalance(admin, user.id),
    ])
    ownedItemIds = new Set((owned ?? []).map((o) => o.item_id))
    equippedItemIds = new Set((owned ?? []).filter((o) => o.equipped).map((o) => o.item_id))
    balance = coinBalance
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col items-center gap-4 pt-8 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Store</p>
          <h1 className="font-display text-3xl font-black uppercase text-white sm:text-4xl">Spend Your SX Coins</h1>
        </div>
        {user ? (
          <div className="shrink-0 rounded-xl border border-sx-border bg-sx-surface px-5 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-sx-gray">Your Balance</p>
            <p className="font-display text-2xl font-black text-white">🪙 {balance.toLocaleString()}</p>
          </div>
        ) : (
          <a href="/login?next=/store" className="rounded-lg bg-sx-purple px-4 py-2.5 text-xs font-bold text-white hover:bg-sx-purple-light">
            Sign in to buy
          </a>
        )}
      </header>
      <StoreGrid items={items ?? []} ownedItemIds={ownedItemIds} equippedItemIds={equippedItemIds} isLoggedIn={!!user} />
    </div>
  )
}

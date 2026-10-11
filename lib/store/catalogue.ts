import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { SITE_URL } from '@/lib/seo/site'

type Admin = SupabaseClient<Database>

export interface StoreItemView {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  priceCoins: number
  previewUrl: string
  owned: boolean
  equipped: boolean
}

export type StoreResult = { ok: true; balance: number | null; items: StoreItemView[] } | { ok: false }

// Preview paths are stored site-relative (`/coin-items/x.webp`); the app needs an absolute URL for the
// network fallback. Absolute URLs pass through.
function absolute(path: string | null): string {
  if (!path) return ''
  return path.startsWith('/') ? `${SITE_URL}${path}` : path
}

// The store for the app. The catalogue is public; ownership, equipped flags and the balance are read ONLY for
// `playerId` (null = signed out, so none of them is returned).
export async function loadStore(admin: Admin, args: { playerId: string | null }): Promise<StoreResult> {
  const catalogue = await admin
    .from('store_items')
    .select('id, slug, name, description, category, price_coins, preview_url, sort_order')
    .eq('active', true)
    .order('category')
    .order('sort_order')
  if (catalogue.error || !catalogue.data) {
    console.error('[store] catalogue read failed', { message: catalogue.error?.message })
    return { ok: false }
  }

  let balance: number | null = null
  const owned = new Set<string>()
  const equipped = new Set<string>()
  if (args.playerId) {
    const [inventory, coins] = await Promise.all([
      admin.from('player_store_items').select('item_id, equipped').eq('player_id', args.playerId),
      admin.from('sx_coins').select('balance').eq('player_id', args.playerId).maybeSingle(),
    ])
    if (inventory.error || coins.error) {
      console.error('[store] inventory read failed', { inventory: inventory.error?.message, coins: coins.error?.message })
      return { ok: false }
    }
    for (const row of inventory.data ?? []) {
      owned.add(row.item_id)
      if (row.equipped) equipped.add(row.item_id)
    }
    balance = coins.data?.balance ?? 0
  }

  // Sorted here as well as in the query so the order never depends on database collation.
  const rows = [...catalogue.data].sort((a, b) => a.category.localeCompare(b.category) || a.sort_order - b.sort_order)
  return {
    ok: true,
    balance,
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      priceCoins: r.price_coins,
      previewUrl: absolute(r.preview_url),
      owned: owned.has(r.id),
      equipped: equipped.has(r.id),
    })),
  }
}

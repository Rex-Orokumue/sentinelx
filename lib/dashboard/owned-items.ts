interface OwnedItemStoreRef {
  slug: string
  name: string
  category: string
  price_coins: number
  preview_url: string | null
}

interface OwnedItemRow {
  item_id: string
  equipped: boolean
  store_items: OwnedItemStoreRef | OwnedItemStoreRef[] | null
}

export interface OwnedItem {
  id: string
  slug: string
  name: string
  category: string
  priceCoins: number
  previewUrl: string | null
  equipped: boolean
}

// Flattens the array-or-object store_items embed (same Supabase join shape
// equippedCosmeticsBySlug handles, lib/store/cosmetics.ts) into a clean list
// for the dashboard's "My Items" card. Equipped items sort first, then by
// category, then by name — ties are otherwise arbitrary Postgres row order.
export function mapOwnedItems(rows: OwnedItemRow[]): OwnedItem[] {
  const items = rows.flatMap((row) => {
    const item = Array.isArray(row.store_items) ? row.store_items[0] : row.store_items
    if (!item) return []
    return [
      {
        id: row.item_id,
        slug: item.slug,
        name: item.name,
        category: item.category,
        priceCoins: item.price_coins,
        previewUrl: item.preview_url,
        equipped: row.equipped,
      },
    ]
  })
  return items.sort((a, b) => {
    if (a.equipped !== b.equipped) return a.equipped ? -1 : 1
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.name.localeCompare(b.name)
  })
}

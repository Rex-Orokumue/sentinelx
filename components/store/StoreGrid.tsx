import { StoreItemCard, type StoreItem } from './StoreItemCard'

// Store categories are a different set than achievement categories
// (ACHIEVEMENT_CATEGORY_LABELS in lib/achievements/catalogue.ts) — mirrors
// the store_items.category CHECK constraint in supabase/migrations/052_sx_coins_store.sql.
export const STORE_CATEGORY_LABELS: Record<string, string> = {
  avatar_border: 'Avatar Borders',
  profile_theme: 'Profile Card Themes',
  username_colour: 'Username Colours',
  bubble_skin: 'Guide Bubble Skins',
}
const STORE_CATEGORY_ORDER = ['avatar_border', 'profile_theme', 'username_colour', 'bubble_skin']

export function StoreGrid({
  items,
  ownedItemIds,
  equippedItemIds,
  isLoggedIn,
}: {
  items: StoreItem[]
  ownedItemIds: Set<string>
  equippedItemIds: Set<string>
  isLoggedIn: boolean
}) {
  return (
    <div className="space-y-10">
      {STORE_CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c)).map((category) => (
        <section key={category}>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-white">{STORE_CATEGORY_LABELS[category]}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items
              .filter((i) => i.category === category)
              .map((item) => (
                <StoreItemCard
                  key={item.id}
                  item={item}
                  owned={ownedItemIds.has(item.id)}
                  equipped={equippedItemIds.has(item.id)}
                  isLoggedIn={isLoggedIn}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// Pure — unit tested directly, no IO. Split out of actions.ts because a
// 'use server' file's exports must all be async server actions; StoreItemCard
// (a client component) imports purchaseStoreItem/equipStoreItem from
// actions.ts, and webpack traces the whole module, so any non-async export
// there fails the build.
export interface PurchaseItemInput {
  item: { active: boolean; price_coins: number }
  alreadyOwned: boolean
  balance: number
}
export type PurchaseDecision = { ok: true } | { ok: false; error: string }

export function decidePurchase({ item, alreadyOwned, balance }: PurchaseItemInput): PurchaseDecision {
  if (!item.active) return { ok: false, error: 'This item is no longer available.' }
  if (alreadyOwned) return { ok: false, error: 'You already own this item.' }
  if (balance < item.price_coins) return { ok: false, error: 'Not enough SX Coins.' }
  return { ok: true }
}

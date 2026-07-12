export interface OrderRow {
  id: string
  listingId: string
  title: string
  amount: number
  status: string
}

// Keeps only the newest order per listing. Callers must pass orders already
// sorted newest-first (e.g. `.order('created_at', { ascending: false })`) —
// a buyer can retry an abandoned "initiated" checkout multiple times before
// paying, and only the most recent attempt for a listing is worth showing.
export function latestPerListing(orders: OrderRow[]): OrderRow[] {
  const seen = new Set<string>()
  const result: OrderRow[] = []
  for (const o of orders) {
    if (seen.has(o.listingId)) continue
    seen.add(o.listingId)
    result.push(o)
  }
  return result
}

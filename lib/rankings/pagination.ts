export const PAGE_SIZE = 10

export interface PageInfo {
  page: number
  totalPages: number
  /** 1-based, for "Showing {from} to {to} of {total}". 0 when the list is empty. */
  from: number
  to: number
  total: number
  /** 0-based slice bounds. */
  startIndex: number
  endIndex: number
}

// An out-of-range page clamps rather than rendering an empty table — a shared or
// stale ?page= link should land somewhere real instead of on nothing.
export function paginate(total: number, page: number, perPage: number = PAGE_SIZE): PageInfo {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const safe = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages)
  const startIndex = (safe - 1) * perPage
  const endIndex = Math.min(startIndex + perPage, total)
  return {
    page: safe,
    totalPages,
    from: total === 0 ? 0 : startIndex + 1,
    to: endIndex,
    total,
    startIndex,
    endIndex,
  }
}

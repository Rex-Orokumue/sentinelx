import Link from 'next/link'
import type { PageInfo } from '@/lib/rankings/pagination'

// Server-rendered page links so a page is a shareable URL. Long ranges collapse
// with an ellipsis rather than printing 149 links.
function pageNumbers(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const out: (number | 'gap')[] = [1]
  const from = Math.max(2, page - 1)
  const to = Math.min(totalPages - 1, page + 1)
  if (from > 2) out.push('gap')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < totalPages - 1) out.push('gap')
  out.push(totalPages)
  return out
}

export function LeaderboardPagination({
  info,
  hrefFor,
}: {
  info: PageInfo
  hrefFor: (page: number) => string
}) {
  if (info.total === 0) return null

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 text-xs sm:flex-row">
      <p className="text-sx-gray">
        Showing {info.from} to {info.to} of {info.total} player{info.total === 1 ? '' : 's'}
      </p>

      {info.totalPages > 1 && (
        <nav aria-label="Pagination" className="flex flex-wrap items-center gap-1">
          {info.page > 1 && (
            <Link href={hrefFor(info.page - 1)} aria-label="Previous page" className={linkCls(false)}>
              ←
            </Link>
          )}
          {pageNumbers(info.page, info.totalPages).map((n, i) =>
            n === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-sx-gray">
                …
              </span>
            ) : (
              <Link key={n} href={hrefFor(n)} className={linkCls(n === info.page)}>
                {n}
              </Link>
            ),
          )}
          {info.page < info.totalPages && (
            <Link href={hrefFor(info.page + 1)} aria-label="Next page" className={linkCls(false)}>
              →
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}

function linkCls(active: boolean): string {
  return `rounded-lg border px-2.5 py-1.5 font-semibold transition-colors ${
    active
      ? 'border-sx-purple bg-sx-purple text-white'
      : 'border-sx-border text-sx-gray hover:text-white'
  }`
}

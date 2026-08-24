import Link from 'next/link'
import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { BuyRequestRow, type AdminBuyRequest } from '@/components/admin/BuyRequestRow'
import { buildBuyerWhatsAppUrl } from '@/lib/exchange/requests-whatsapp'
import { EmptyState } from '@/components/shared/EmptyState'
import type { ListingCategory } from '@/lib/exchange/schema'
import type { BuyRequestStatus } from '@/lib/exchange/requests-guards'

export const metadata: Metadata = { title: 'Buy requests · Admin · SentinelX' }

const REQUESTS_PAGE_SIZE = 100

type BuyerRef = { username: string | null; whatsapp_number: string | null; country: string | null } | null

type Row = {
  id: string
  title: string
  budget: number
  category: ListingCategory
  status: BuyRequestStatus
  buyer: BuyerRef | BuyerRef[]
}

export default async function AdminBuyRequestsPage({
  searchParams,
}: {
  searchParams: { status?: string }
}) {
  await requireStaff()
  const supabase = createClient()

  const VALID_STATUSES = ['open', 'in_progress', 'fulfilled', 'closed'] as const
  const statusFilter = VALID_STATUSES.includes(searchParams.status as (typeof VALID_STATUSES)[number])
    ? searchParams.status
    : undefined

  let q = supabase
    .from('buy_requests')
    .select(
      'id, title, budget, category, status, ' +
        'buyer:profiles!buy_requests_buyer_id_fkey(username, whatsapp_number, country)',
    )
    .order('created_at', { ascending: false })
    .limit(REQUESTS_PAGE_SIZE)
  if (statusFilter) q = q.eq('status', statusFilter)

  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  const requests: AdminBuyRequest[] = rows.map((r) => {
    const buyer = Array.isArray(r.buyer) ? r.buyer[0] ?? null : r.buyer
    return {
      id: r.id,
      title: r.title,
      budget: r.budget,
      category: r.category,
      status: r.status,
      buyerName: buyer?.username ?? 'buyer',
      whatsappUrl: buildBuyerWhatsAppUrl({
        buyerWhatsapp: buyer?.whatsapp_number ?? null,
        buyerCountry: buyer?.country ?? null,
        buyerName: buyer?.username ?? 'buyer',
        requestTitle: r.title,
        budget: r.budget,
      }),
    }
  })

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-white">Buy requests</h1>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(['all', ...VALID_STATUSES] as const).map((s) => (
          <Link
            key={s}
            href={s === 'all' ? '/admin/exchange/requests' : `/admin/exchange/requests?status=${s}`}
            className={`rounded-full border px-3 py-1 font-bold ${
              (s === 'all' && !statusFilter) || s === statusFilter
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-slate-800 text-slate-400 hover:border-slate-600'
            }`}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1).replace('_', ' ')}
          </Link>
        ))}
      </div>
      {requests.length === 0 ? (
        <EmptyState icon="🔎" title="No requests" body="No buy requests match this filter." />
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <BuyRequestRow key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  )
}

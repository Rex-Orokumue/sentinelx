import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { StoreItemForm } from '@/components/admin/StoreItemForm'

export const metadata: Metadata = { title: 'Store · Admin · SentinelX' }

export default async function AdminStorePage() {
  await requireAdmin()
  const admin = createAdminClient()
  const { data: items } = await admin
    .from('store_items')
    .select('id, slug, name, category, price_coins, active, sort_order')
    .order('category')
    .order('sort_order')

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Store Items</h1>
      <StoreItemForm mode="create" />
      <table className="mt-8 w-full text-sm text-slate-300">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr><th className="py-2">Name</th><th>Category</th><th>Price</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {(items ?? []).map((item) => (
            <StoreItemForm key={item.id} mode="edit" item={item} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

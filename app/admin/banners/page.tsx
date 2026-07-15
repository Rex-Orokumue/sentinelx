import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { BannerForm } from '@/components/admin/BannerForm'
import { BannerRow } from '@/components/admin/BannerRow'

export const metadata: Metadata = { title: 'Homepage Banner · Admin · SentinelX' }

export default async function AdminBannersPage() {
  await requireStaff()
  const supabase = createClient()
  const { data: banners } = await supabase
    .from('homepage_banners')
    .select('id, title, image_url, link_url, active')
    .order('created_at', { ascending: false })

  const rows = (banners ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    imageUrl: b.image_url,
    linkUrl: b.link_url,
    active: b.active,
  }))

  return (
    <section>
      <h2 className="mb-1 text-base font-bold text-white">Homepage Banner</h2>
      <p className="mb-4 text-xs text-slate-500">
        Promote an upcoming tournament or season on the homepage — independent of the
        tournament&apos;s own publish status. Only one banner should be active at a time.
      </p>
      <div className="mb-6">
        <BannerForm />
      </div>
      <div className="space-y-2">
        {rows.map((b) => (
          <BannerRow key={b.id} banner={b} />
        ))}
      </div>
    </section>
  )
}

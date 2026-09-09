import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { fetchAdminPosts, fetchAdminNominations, fetchAdminStatuses } from '@/lib/community/admin-query'
import { AdminAnnouncementForm } from '@/components/admin/AdminAnnouncementForm'
import { AdminPostList } from '@/components/admin/AdminPostList'
import { AdminStatusList } from '@/components/admin/AdminStatusList'
import { AdminBestPlayPanel } from '@/components/admin/AdminBestPlayPanel'

export const metadata: Metadata = { title: 'Community · Admin · SentinelX' }

export default async function AdminCommunityPage() {
  await requireStaff()
  const [posts, nominations, statuses] = await Promise.all([
    fetchAdminPosts(),
    fetchAdminNominations(),
    fetchAdminStatuses(),
  ])

  return (
    <div className="space-y-6">
      <AdminAnnouncementForm />

      <section>
        <h2 className="mb-3 text-base font-bold text-white">Best Play of the Week</h2>
        <AdminBestPlayPanel nominations={nominations} />
      </section>

      <section>
        <h2 className="mb-3 text-base font-bold text-white">Community — recent posts</h2>
        {posts.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">No posts yet.</p>
        ) : (
          <AdminPostList posts={posts} />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-bold text-white">Statuses — live</h2>
        <AdminStatusList statuses={statuses} />
      </section>
    </div>
  )
}

import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { DashboardPushBanner } from '@/components/notifications/DashboardPushBanner'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff()
  const items = visibleNav(ADMIN_NAV, ctx.isAdmin)
  const notifications = await getAdminNotificationQueue(ctx.isAdmin ? 'admin' : 'moderator')
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:flex sm:gap-6">
      <AdminSidebar items={items} isAdmin={ctx.isAdmin} notifications={notifications} />
      <div className="min-w-0 flex-1 py-6">
        <div className="mb-6 empty:mb-0">
          <DashboardPushBanner />
        </div>
        {children}
      </div>
    </div>
  )
}

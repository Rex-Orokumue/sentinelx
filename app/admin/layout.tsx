import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff()
  const items = visibleNav(ADMIN_NAV, ctx.isAdmin)
  const notifications = await getAdminNotificationQueue(ctx.isAdmin ? 'admin' : 'moderator')
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:flex sm:gap-6">
      <AdminSidebar items={items} isAdmin={ctx.isAdmin} notifications={notifications} />
      <div className="min-w-0 flex-1 py-6">{children}</div>
    </div>
  )
}

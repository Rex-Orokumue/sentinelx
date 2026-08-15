'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { isAdminNavActive, type AdminNavItem } from '@/lib/admin/nav'
import { countByHref, type AdminNotificationItem } from '@/lib/admin/notification-copy'
import { AdminNotificationBell } from './AdminNotificationBell'

function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  return (
    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
      {isAdmin ? 'Admin' : 'Moderator'}
    </span>
  )
}

function NavList({
  items,
  pathname,
  badgeCounts,
}: {
  items: AdminNavItem[]
  pathname: string
  badgeCounts: Record<string, number>
}) {
  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = isAdminNavActive(item.href, pathname)
        const count = badgeCounts[item.href] ?? 0
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
            {count > 0 && (
              <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

export function AdminSidebar({
  items,
  isAdmin,
  notifications,
}: {
  items: AdminNavItem[]
  isAdmin: boolean
  notifications: AdminNotificationItem[]
}) {
  const pathname = usePathname()
  const badgeCounts = countByHref(notifications)

  return (
    <aside className="hidden w-52 shrink-0 sm:block">
      <div className="sticky top-20 py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="text-lg font-black text-white">Admin</span>
          <div className="flex items-center gap-2">
            <AdminNotificationBell items={notifications} />
            <RoleBadge isAdmin={isAdmin} />
          </div>
        </div>
        <NavList items={items} pathname={pathname} badgeCounts={badgeCounts} />
      </div>
    </aside>
  )
}

import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminNav } from '@/components/admin/AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff()
  const items = visibleNav(ADMIN_NAV, ctx.isAdmin)
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="flex items-center justify-between gap-4 py-6">
        <h1 className="text-xl font-black text-white">Admin</h1>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {ctx.isAdmin ? 'Admin' : 'Moderator'}
        </span>
      </div>
      <AdminNav items={items} />
      <div className="mt-6">{children}</div>
    </div>
  )
}

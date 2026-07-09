'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import type { AdminNavItem } from '@/lib/admin/nav'

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
  onNavigate,
}: {
  items: AdminNavItem[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`block rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AdminSidebar({ items, isAdmin }: { items: AdminNavItem[]; isAdmin: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between gap-3 py-4 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
          className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-200 hover:border-slate-500"
        >
          <Menu className="h-4 w-4" /> Menu
        </button>
        <RoleBadge isAdmin={isAdmin} />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-slate-800 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-black text-white">Admin</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin menu"
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-52 shrink-0 sm:block">
        <div className="sticky top-20 py-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="text-lg font-black text-white">Admin</span>
            <RoleBadge isAdmin={isAdmin} />
          </div>
          <NavList items={items} pathname={pathname} />
        </div>
      </aside>
    </>
  )
}

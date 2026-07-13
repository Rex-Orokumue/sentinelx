'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { signOut } from '@/lib/auth/actions'
import { Avatar } from '@/components/shared/Avatar'
import type { NavSession } from '@/lib/nav/session'

export function AccountMenu({ session }: { session: NavSession }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  if (!session.isLoggedIn) {
    return (
      <Link
        href="/login"
        className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Log in
      </Link>
    )
  }

  const name = session.displayName ?? session.username ?? 'Account'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex max-w-[10rem] items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 ring-1 ring-slate-700 transition hover:ring-slate-500"
      >
        <Avatar
          avatarUrl={session.avatarUrl}
          displayName={session.displayName}
          username={session.username}
          size={26}
        />
        <span className="truncate text-sm font-semibold text-slate-200">{name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
          <MenuLink
            href={session.username ? `/players/${session.username}` : '/dashboard'}
            onNavigate={() => setOpen(false)}
          >
            My Profile
          </MenuLink>
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>Dashboard</MenuLink>
          {session.isStaff && (
            <MenuLink href="/admin" onNavigate={() => setOpen(false)}>Admin</MenuLink>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="block w-full px-4 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function MenuLink({
  href,
  onNavigate,
  children,
}: {
  href: string
  onNavigate: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="block px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
    >
      {children}
    </Link>
  )
}

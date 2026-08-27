'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { NavLink } from '@/lib/nav/links'

// Overflow bucket for the desktop header's secondary link set — see
// lib/nav/links.ts's NAVBAR_PRIMARY_LINKS/NAVBAR_MORE_LINKS comment for why
// this split exists. Same ref + outside-click + Escape dropdown pattern as
// AccountMenu, so the header has one consistent dropdown interaction, not
// two different ones.
export function NavMoreDropdown({ links, active }: { links: NavLink[]; active: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const t = useTranslations('nav')

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

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('more')}
        aria-expanded={open}
        className={`flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
          active || open ? 'border-sx-purple text-white' : 'border-transparent text-white/70 hover:text-white'
        }`}
      >
        {t('more')}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-44 rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block whitespace-nowrap px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
            >
              {t(link.labelKey)}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

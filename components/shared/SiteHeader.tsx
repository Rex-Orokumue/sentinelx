'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'

const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/rankings', label: 'Rankings' },
]

export function SiteHeader({
  authNav,
  whatsappUrl,
}: {
  authNav: React.ReactNode
  whatsappUrl: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        {/* Logo */}
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex shrink-0 items-center gap-2"
        >
          <Image src="/logo-icon.png" alt="SentinelX Esports" width={32} height={32} priority />
          <span className="flex flex-col leading-none">
            <span className="whitespace-nowrap font-display text-lg font-bold uppercase tracking-wide text-white sm:text-xl">
              Sentinel<span className="text-violet-400">X</span>
            </span>
            <span className="font-display text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
              Esports
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Desktop links */}
          <div className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              <span>Community</span>
            </a>
          </div>

          {/* Auth — desktop inline; mobile moves into the dropdown below */}
          <div className="hidden sm:block">{authNav}</div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white sm:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="space-y-1 border-t border-slate-800 bg-slate-950 px-4 py-3 sm:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 py-2.5 text-sm font-bold text-white"
          >
            <WhatsAppIcon className="h-4 w-4" />
            Join our WhatsApp Community
          </a>
          <div className="mt-1 border-t border-slate-800 pt-2">{authNav}</div>
        </div>
      )}
    </header>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

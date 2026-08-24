'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Globe } from 'lucide-react'
import { LOCALES, type Locale } from '@/i18n/locales'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useLocale } from 'next-intl'

const SHORT_LABELS: Record<Locale, string> = { en: 'EN', fr: 'FR', pcm: 'PCM' }
const FULL_LABELS: Record<Locale, string> = { en: 'English', fr: 'Français', pcm: 'Pidgin' }

export function LanguageSwitcher() {
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
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

  async function switchTo(next: Locale) {
    setOpen(false)
    if (next === locale) return
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    })
    router.replace(pathname, { locale: next })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change language"
        aria-expanded={open}
        className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-white/80 transition hover:bg-white/5"
      >
        <Globe className="h-4 w-4" />
        <span>{SHORT_LABELS[locale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => switchTo(l)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
            >
              <span className={l === locale ? 'font-semibold text-white' : undefined}>{FULL_LABELS[l]}</span>
              {l === locale && <Check className="h-4 w-4 text-sx-purple-text" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

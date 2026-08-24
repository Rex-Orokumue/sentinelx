'use client'
import { LOCALES, type Locale } from '@/i18n/locales'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useLocale } from 'next-intl'

const LABELS: Record<Locale, string> = { en: 'EN', fr: 'FR', pcm: 'Pidgin' }

export function LanguageSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  async function switchTo(next: Locale) {
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    })
    router.replace(pathname, { locale: next })
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          disabled={l === locale}
          className={l === locale ? 'font-bold text-white' : 'text-sx-gray hover:text-white'}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
